#!/usr/bin/env python3
"""
local_text2img.py

Simple script to run a local text-to-image (text2img) model using Hugging Face Diffusers.

Features:
- Load a local/remote Stable Diffusion pipeline (FP16 if GPU available)
- Simple CLI: prompt, output path, height/width, guidance scale, steps, device
- Saves generated image(s) to disk

This is a minimal, easy-to-adapt example for running a text->image model locally.
"""
import argparse
import os
from typing import Optional
import sys
from datetime import datetime
import torch

try:
    from diffusers import StableDiffusionPipeline  # type: ignore[import]
except (ImportError, ModuleNotFoundError) as e:
    install_cmd = f"{sys.executable} -m pip install -r requirements.txt"
    msg = (
        "Required package 'diffusers' is not installed.\n"
        "Please install the dependencies for this project.\n"
        f"You can run the following command in the same Python environment that runs this script:\n\n  {install_cmd}\n\n"
        "If you use conda, activate the environment first, or run the equivalent conda/pip install.\n"
        f"Original error: {e}"
    )
    raise SystemExit(msg)


def parse_args():
    parser = argparse.ArgumentParser(description="Local text-to-image using diffusers")
    parser.add_argument("prompt", nargs='?', default=(
        "漂亮的女性肖像，清晰细腻的面部特征，温柔微笑，淡雅妆容，柔和光线，浅景深，4k 超高清，写实风格"
    ), type=str, help="Text prompt to generate image from (optional, default is a beauty portrait in Chinese)")
    parser.add_argument("--model", type=str, default=r"G:\AIModels\modelscope_cache\models\AI-ModelScope\stable-diffusion-v1-5",
                        help="Model id or path (local folder or HF repo id).")
    parser.add_argument("--out", type=str, default="output.png", help="Output image path")
    parser.add_argument("--height", type=int, default=512, help="Image height")
    parser.add_argument("--width", type=int, default=512, help="Image width")
    parser.add_argument("--steps", type=int, default=30, help="Number of inference steps")
    parser.add_argument("--scale", type=float, default=7.5, help="Guidance scale")
    parser.add_argument("--device", type=str, default=None, help="torch device to use (auto, cpu, cuda)")
    parser.add_argument("--seed", type=int, default=None, help="Random seed (optional)")
    parser.add_argument("--trust-remote-code", action="store_true",
                        help="Allow execution of model repository code (useful for custom pipelines).")
    return parser.parse_args()


def choose_device(requested: Optional[str]) -> torch.device:
    if requested in (None, "auto"):
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if requested == "cuda":
        return torch.device("cuda")
    return torch.device("cpu")


def load_pipeline(model_id: str, device: torch.device, trust_remote_code: bool = False):
    # Detect local path and load accordingly
    local_only = os.path.isdir(model_id)
    # For GPUs, enable half precision if available
    torch_dtype = torch.float16 if device.type == "cuda" else torch.float32

    load_kwargs = {
        "torch_dtype": torch_dtype,
        "local_files_only": local_only,
    }
    # If user explicitly wants to allow running repo code (for custom pipelines), pass the flag
    if trust_remote_code:
        load_kwargs["trust_remote_code"] = True

    # Inform user if model path looks like a checkpoint bundle
    if local_only:
        try:
            import glob
            import json
            ckpt_files = glob.glob(os.path.join(model_id, "*.ckpt")) + glob.glob(os.path.join(model_id, "*.safetensors"))
            if ckpt_files:
                print(f"Detected checkpoint-like files in {model_id}: {os.path.basename(ckpt_files[0])}")
            # If there's a model_index.json, inspect it to provide clearer guidance
            model_index_path = os.path.join(model_id, "model_index.json")
            if os.path.exists(model_index_path):
                try:
                    with open(model_index_path, "r", encoding="utf-8") as f:
                        idx = json.load(f)
                    cls = idx.get("_class_name")
                    df_ver = idx.get("_diffusers_version")
                    if cls and cls != "StableDiffusionPipeline":
                        print(f"Model declares custom pipeline class: {cls} (diffusers version: {df_ver})")
                        print()
                        print("Note: this model requires a matching diffusers version or custom pipeline support.")
                        print("If you get errors about missing pipeline components, install the latest diffusers from GitHub:")
                        print(f"  {sys.executable} -m pip install -U git+https://github.com/huggingface/diffusers.git")
                        print("Alternatively, if the model repository includes custom pipeline code, re-run with --trust-remote-code to allow executing it.")
                except Exception:
                    pass
        except Exception:
            pass

    # Try to load a StableDiffusionPipeline; many local models use this.
    try:
        pipe = StableDiffusionPipeline.from_pretrained(model_id, **load_kwargs)
    except Exception as e:
        # Provide a helpful message for common cases (checkpoint vs diffusers format)
        msg = (
            f"Failed to load pipeline from '{model_id}' (local_files_only={local_only}).\n"
            "If your model is a .ckpt or .safetensors checkpoint, you may need to convert it to the diffusers format first\n"
            "(see: https://github.com/huggingface/diffusers/tree/main/scripts/convert_sd_checkpoint_to_diffusers).\n"
            "If the model requires custom code, try re-running with --trust-remote-code.\n"
            f"Original error: {e}"
        )
        raise RuntimeError(msg)

    # Move to device
    pipe = pipe.to(device)

    return pipe


def generate(prompt: str, out_path: str, model: str, height: int, width: int, steps: int, scale: float, device: torch.device, seed: Optional[int], trust_remote_code: bool = False):
    pipe = load_pipeline(model, device, trust_remote_code=trust_remote_code)

    # set seed
    generator = None
    if seed is not None:
        generator = torch.Generator(device=device).manual_seed(seed)

    # The pipeline may accept height/width (most pipelines do)
    result = pipe(prompt=prompt, height=height, width=width, num_inference_steps=steps,
                  guidance_scale=scale, generator=generator)

    image = result.images[0]
    # Ensure output dir exists
    os.makedirs(os.path.dirname(os.path.abspath(out_path)) or ".", exist_ok=True)
    image.save(out_path)

    return out_path


def main():
    args = parse_args()
    device = choose_device(args.device)
    print(f"Using device: {device}")

    # If user didn't provide a custom output filename (left default or empty),
    # create a timestamped filename like localmodelImage2025-10-14-12-08.png
    if not args.out or args.out == "output.png":
        timestamp = datetime.now().strftime("%Y-%m-%d-%H-%M")
        out_path = f"localmodelImage{timestamp}.png"
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
