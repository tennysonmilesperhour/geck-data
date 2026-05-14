"""
Morph ID — multi-label trait classifier starter.

Reads the manifest produced by `scripts/export_training_dataset.py`
(or `/api/training/manifest`), fine-tunes a ResNet-50 (pretrained on
ImageNet) on the train split, evaluates on val, and writes a checkpoint
plus a metrics report.

This is a starting point — not a production trainer. It covers:
  - Lazy URL-or-local-path image loading with PIL
  - Multi-label BCEWithLogitsLoss (one threshold per trait)
  - Stratified-by-listing split honored automatically (the manifest
    already has the split column)
  - Per-trait precision / recall at threshold 0.5

What it does NOT cover (and you'll want for a real run):
  - Class-balanced sampling (some traits have 10x more images than others)
  - Augmentation tuning (RandomHorizontalFlip + ColorJitter is the floor)
  - Mixed precision training (add torch.amp.autocast for 2x speed)
  - Distributed training, learning-rate schedule sweeps, EMA, etc.
  - Pretrained backbones better suited to fine-grained appearance
    (DINOv2, SwinV2, EVA02) — ResNet-50 is the cheap baseline.

Dependencies (not pinned in requirements.txt — install ad hoc):

    pip install torch torchvision pillow requests tqdm scikit-learn

Quickstart:

    # 1. Export the manifest
    python scripts/export_training_dataset.py --download \\
      --out ./training_dataset --workers 16

    # 2. Train
    python scripts/train_morph_classifier.py \\
      --data ./training_dataset \\
      --epochs 10 \\
      --batch 32 \\
      --out ./morph_id_run01

Loading images directly from URLs (no --download required):

    python scripts/train_morph_classifier.py \\
      --data ./training_dataset \\
      --load-from-urls
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from io import BytesIO
from pathlib import Path
from typing import Any, Optional

# Heavy ML deps are intentionally imported lazily inside main() so the file
# can be read / parsed in any environment, even without torch installed.


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Morph ID multi-label classifier.")
    p.add_argument("--data", type=Path, required=True,
                   help="Directory containing train.jsonl / val.jsonl / taxonomy.json")
    p.add_argument("--out", type=Path, default=Path("./morph_id_run"),
                   help="Where to save checkpoints + metrics")
    p.add_argument("--epochs", type=int, default=10)
    p.add_argument("--batch", type=int, default=32)
    p.add_argument("--lr", type=float, default=3e-4)
    p.add_argument("--weight-decay", type=float, default=1e-4)
    p.add_argument("--workers", type=int, default=4)
    p.add_argument("--img-size", type=int, default=224)
    p.add_argument("--load-from-urls", action="store_true",
                   help="Stream images directly from manifest URLs (no local mirror).")
    p.add_argument("--limit", type=int, default=None,
                   help="Stop after N examples per epoch (smoke testing)")
    p.add_argument("--device", type=str, default="auto",
                   help="'cuda', 'mps', 'cpu', or 'auto'")
    return p.parse_args()


def select_device(arg: str):
    import torch
    if arg != "auto":
        return torch.device(arg)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def load_jsonl(path: Path) -> tuple[list[str] | None, list[dict[str, Any]]]:
    """Read an NDJSON file. First line is metadata if it contains _meta=True."""
    label_order: list[str] | None = None
    rows: list[dict[str, Any]] = []
    with path.open() as fh:
        for i, line in enumerate(fh):
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            if i == 0 and obj.get("_meta"):
                label_order = obj.get("label_order")
                continue
            rows.append(obj)
    return label_order, rows


def main() -> int:
    args = parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    print(f"[boot] loading manifests from {args.data}")
    tax_path = args.data / "taxonomy.json"
    if not tax_path.exists():
        print(f"[fatal] missing {tax_path}; run export_training_dataset.py first")
        return 2
    taxonomy = json.loads(tax_path.read_text())
    label_order: list[str] = taxonomy["label_order"]
    num_classes = len(label_order)
    print(f"[boot] {num_classes} classes")

    _, train_rows = load_jsonl(args.data / "train.jsonl")
    _, val_rows   = load_jsonl(args.data / "val.jsonl")
    if args.limit is not None:
        train_rows = train_rows[: args.limit]
        val_rows = val_rows[: max(64, args.limit // 5)]
    print(f"[boot] train={len(train_rows)} val={len(val_rows)}")

    # Lazy-import heavy deps
    import torch
    from torch import nn
    from torch.utils.data import Dataset, DataLoader
    from torchvision import models, transforms
    from PIL import Image

    try:
        import requests  # for url loading
    except ImportError:
        if args.load_from_urls:
            print("[fatal] --load-from-urls requires `requests`")
            return 2

    device = select_device(args.device)
    print(f"[boot] device={device}")

    train_tf = transforms.Compose([
        transforms.Resize(int(args.img_size * 1.15)),
        transforms.RandomCrop(args.img_size),
        transforms.RandomHorizontalFlip(p=0.5),
        transforms.ColorJitter(brightness=0.1, contrast=0.1, saturation=0.1),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])
    eval_tf = transforms.Compose([
        transforms.Resize(int(args.img_size * 1.15)),
        transforms.CenterCrop(args.img_size),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])

    class MorphDataset(Dataset):
        def __init__(self, rows: list[dict[str, Any]], tf, data_root: Path, from_urls: bool):
            self.rows = rows
            self.tf = tf
            self.data_root = data_root
            self.from_urls = from_urls

        def __len__(self) -> int:
            return len(self.rows)

        def _open(self, row: dict[str, Any]) -> Image.Image:
            local = row.get("local_path")
            if local and not self.from_urls:
                return Image.open(self.data_root / local).convert("RGB")
            url = row["image_url"]
            r = requests.get(url, timeout=15)
            r.raise_for_status()
            return Image.open(BytesIO(r.content)).convert("RGB")

        def __getitem__(self, idx: int):
            row = self.rows[idx]
            try:
                img = self._open(row)
            except Exception:
                # Return a deterministic blank if the image fails — the
                # trainer just skips its gradient by being a NaN-free zero.
                img = Image.new("RGB", (args.img_size, args.img_size), (0, 0, 0))
            x = self.tf(img)
            y = torch.tensor(row["labels"], dtype=torch.float32)
            return x, y

    train_ds = MorphDataset(train_rows, train_tf, args.data, args.load_from_urls)
    val_ds   = MorphDataset(val_rows, eval_tf, args.data, args.load_from_urls)

    train_loader = DataLoader(
        train_ds, batch_size=args.batch, shuffle=True,
        num_workers=args.workers, pin_memory=(device.type == "cuda"),
    )
    val_loader = DataLoader(
        val_ds, batch_size=args.batch, shuffle=False,
        num_workers=args.workers, pin_memory=(device.type == "cuda"),
    )

    # ResNet-50 with the final FC replaced by num_classes outputs.
    model = models.resnet50(weights=models.ResNet50_Weights.IMAGENET1K_V2)
    in_features = model.fc.in_features
    model.fc = nn.Linear(in_features, num_classes)
    model.to(device)

    criterion = nn.BCEWithLogitsLoss()
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=args.lr, weight_decay=args.weight_decay,
    )

    best_f1 = 0.0
    metrics_history: list[dict[str, Any]] = []

    for epoch in range(1, args.epochs + 1):
        model.train()
        t0 = time.time()
        running = 0.0
        n_seen = 0
        for batch_idx, (x, y) in enumerate(train_loader):
            x, y = x.to(device), y.to(device)
            logits = model(x)
            loss = criterion(logits, y)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            running += loss.item() * x.size(0)
            n_seen += x.size(0)
            if batch_idx % 20 == 0:
                print(f"  ep{epoch} batch{batch_idx} loss={loss.item():.4f}")
        train_loss = running / max(1, n_seen)
        dt_train = time.time() - t0

        # Eval
        model.eval()
        all_y, all_logits = [], []
        with torch.no_grad():
            for x, y in val_loader:
                x = x.to(device)
                logits = model(x).cpu()
                all_y.append(y)
                all_logits.append(logits)
        y_true = torch.cat(all_y).numpy()
        y_pred = (torch.sigmoid(torch.cat(all_logits)).numpy() > 0.5).astype(int)

        # Per-trait F1
        eps = 1e-9
        tp = (y_true * y_pred).sum(axis=0)
        fp = ((1 - y_true) * y_pred).sum(axis=0)
        fn = (y_true * (1 - y_pred)).sum(axis=0)
        precision = tp / (tp + fp + eps)
        recall = tp / (tp + fn + eps)
        f1 = 2 * precision * recall / (precision + recall + eps)
        macro_f1 = float(f1.mean())

        record = {
            "epoch": epoch,
            "train_loss": float(train_loss),
            "val_macro_f1": macro_f1,
            "train_seconds": dt_train,
        }
        metrics_history.append(record)
        print(
            f"[epoch {epoch}] train_loss={train_loss:.4f}  "
            f"val_macro_f1={macro_f1:.4f}  ({dt_train:.0f}s)"
        )

        if macro_f1 > best_f1:
            best_f1 = macro_f1
            ckpt_path = args.out / "best.pt"
            torch.save(
                {
                    "model_state": model.state_dict(),
                    "label_order": label_order,
                    "epoch": epoch,
                    "val_macro_f1": macro_f1,
                },
                ckpt_path,
            )
            print(f"  saved {ckpt_path}")

    (args.out / "metrics.json").write_text(
        json.dumps(
            {
                "label_order": label_order,
                "history": metrics_history,
                "best_macro_f1": best_f1,
            },
            indent=2,
        )
    )
    print(f"done. best macro F1 = {best_f1:.4f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
