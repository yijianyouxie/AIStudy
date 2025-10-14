#!/usr/bin/env python3
"""
local_flux_text2img.py

Load and run a local FLUX text->image model that declares a custom FluxPipeline.

This script attempts to load the model with DiffusionPipeline.from_pretrained. It
supports --trust-remote-code (default True), device selection, and timestamped output.

Usage examples:
  python local_flux_text2img.py "A portrait of a woman" --model "G:/AIModels/.../FLUX___1-dev"
  python local_flux_text2img.py --trust-remote-code

Note: this model may require a development version of diffusers. If loading fails,
the script will print guidance about installing diffusers from GitHub.
"""
import argparse
import os
import sys
from datetime import datetime
from typing import Optional

import torch

try:
    from diffusers import DiffusionPipeline  # type: ignore[import]
except (ImportError, ModuleNotFoundError) as e:
    install_cmd = f"{sys.executable} -m pip install -r requirements.txt"
    msg = (
        "Required package 'diffusers' is not installed or not available in this environment.\n"
        "Please install the dependencies for this project.\n"
        f"You can run the following command in the same Python environment that runs this script:\n\n  {install_cmd}\n\n"
        "If you use conda, activate the environment first, or run the equivalent conda/pip install.\n"
        f"Original error: {e}"
    )
    raise SystemExit(msg)


def parse_args():
    parser = argparse.ArgumentParser(description="Local Flux text-to-image loader")
    parser.add_argument("prompt", nargs="?", default=(
        "漂亮的女性肖像，清晰细腻的面部特征，温柔微笑，淡雅妆容，柔和光线，浅景深，4k 超高清，写实风格"
    ), type=str, help="Text prompt to generate image from (optional)")
    parser.add_argument("--model", type=str, default=r"G:/AIModels/modelscope_cache/models/black-forest-labs/FLUX___1-dev",
                        help="Model id or path (local folder or HF repo id).")
    parser.add_argument("--out", type=str, default="", help="Output image path (optional). If omitted a timestamped filename will be used.")
    parser.add_argument("--height", type=int, default=512, help="Image height")
    parser.add_argument("--width", type=int, default=512, help="Image width")
    parser.add_argument("--steps", type=int, default=30, help="Number of inference steps")
    parser.add_argument("--scale", type=float, default=7.5, help="Guidance scale")
    parser.add_argument("--device", type=str, default=None, help="torch device to use (auto, cpu, cuda)")
    parser.add_argument("--seed", type=int, default=None, help="Random seed (optional)")
    parser.add_argument("--trust-remote-code", dest="trust_remote_code", action="store_true",
                        help="Allow execution of model repository code (useful for custom pipelines).")
    parser.add_argument("--no-trust-remote-code", dest="trust_remote_code", action="store_false",
                        help="Do not allow executing remote model code.")
    parser.set_defaults(trust_remote_code=True)
    return parser.parse_args()


def choose_device(requested: Optional[str]) -> torch.device:
    if requested in (None, "auto"):
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if requested == "cuda":
        return torch.device("cuda")
    return torch.device("cpu")


def load_flux_pipeline(model_id: str, device: torch.device, trust_remote_code: bool):
    local_only = os.path.isdir(model_id)
    # prefer dtype kwarg
    dtype = torch.float16 if device.type == "cuda" else torch.float32

    load_kwargs = {
        "dtype": dtype,
        "local_files_only": local_only,
        "trust_remote_code": trust_remote_code,
    }

    # If local model has model_index.json, inspect class
    try:
        model_index = os.path.join(model_id, "model_index.json")
        if os.path.exists(model_index):
            try:
                import json
                with open(model_index, "r", encoding="utf-8") as f:
                    idx = json.load(f)
                cls = idx.get("_class_name")
                if cls:
                    print(f"Model declares pipeline class: {cls}")
            except Exception:
                pass
    except Exception:
        pass

    try:
        print("Loading pipeline components...", flush=True)
        pipe = DiffusionPipeline.from_pretrained(model_id, **load_kwargs)
    except Exception as e:
        # Provide actionable guidance
        msg = (
            f"Failed to load pipeline from '{model_id}' (local_files_only={local_only}).\n"
            "This model appears to declare a custom pipeline (e.g. FluxPipeline) and may require a specific diffusers version or running remote code.\n"
            "Recommended steps:\n"
            f"  1) Install the development diffusers from GitHub: {sys.executable} -m pip install -U git+https://github.com/huggingface/diffusers.git\n"
            "  2) Or run this script with --trust-remote-code to allow executing model repo code (only for trusted sources).\n"
            "  3) If the model is a raw checkpoint (.ckpt/.safetensors), you may need to convert it to diffusers format.\n"
            f"Original error: {e}"
        )
        raise RuntimeError(msg)

    # Move to device
    pipe = pipe.to(device)

    # Try to enable memory-savers commonly useful for low VRAM
    try:
        pipe.enable_attention_slicing()
    except Exception:
        pass

    return pipe


def generate(prompt: str, out_path: str, model: str, height: int, width: int, steps: int, scale: float, device: torch.device, seed: Optional[int], trust_remote_code: bool):
    pipe = load_flux_pipeline(model, device, trust_remote_code)

    generator = None
    if seed is not None:
        generator = torch.Generator(device=device).manual_seed(seed)

    # Call pipeline
    result = pipe(prompt=prompt, height=height, width=width, num_inference_steps=steps,
                  guidance_scale=scale, generator=generator)

    # save first image
    image = result.images[0]
    os.makedirs(os.path.dirname(os.path.abspath(out_path)) or ".", exist_ok=True)
    image.save(out_path)
    return out_path


def main():
    args = parse_args()
    device = choose_device(args.device)
    print(f"Using device: {device}")

    if not args.out:
        timestamp = datetime.now().strftime("%Y-%m-%d-%H-%M")
        out_path = f"localFluxImage{timestamp}.png"
    else:
        out_path = args.out

    out = generate(
        prompt=args.prompt,
        out_path=out_path,
        model=args.model,
        height=args.height,
        width=args.width,
        steps=args.steps,
        scale=args.scale,
        device=device,
        seed=args.seed,
        trust_remote_code=args.trust_remote_code,
    )

    print(f"Saved image to: {out}")


if __name__ == "__main__":
    main()
