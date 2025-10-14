#!/usr/bin/env python3
"""
local_sd_v1_5_text2img.py

Load and run a local Stable Diffusion v1.5 model saved in diffusers format.
Supports low-vram helpers and timestamped output filenames.
"""
import argparse
import os
import sys
from datetime import datetime
from typing import Optional

import torch

try:
    from diffusers import StableDiffusionPipeline
except (ImportError, ModuleNotFoundError) as e:
    install_cmd = f"{sys.executable} -m pip install -r requirements.txt"
    raise SystemExit(f"Missing diffusers. Run: {install_cmd}\nOriginal error: {e}")


def parse_args():
    parser = argparse.ArgumentParser(description="Local Stable Diffusion v1.5 text2img")
    parser.add_argument("prompt", nargs="?", default=(
        "欧洲中世纪女战士 4k 超高清"
    ), type=str)
    parser.add_argument("--model", type=str, default=r"G:/AIModels/modelscope_cache/models/AI-ModelScope/stable-diffusion-v1-5",
    # parser.add_argument("--model", type=str, default=r"G:\AIModels\modelscope_cache\models\AI-ModelScope\stable-diffusion-v2-1",
                        help="Local diffusers model directory")
    parser.add_argument("--out", type=str, default="", help="Output image path")
    parser.add_argument("--height", type=int, default=512)
    parser.add_argument("--width", type=int, default=512)
    parser.add_argument("--steps", type=int, default=30)
    parser.add_argument("--scale", type=float, default=7.5)
    parser.add_argument("--device", type=str, default=None)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--lowvram", action="store_true", help="Enable low VRAM helpers (attention slicing, cpu offload if available)")
    parser.add_argument("--trust-remote-code", action="store_true", help="Allow executing custom pipeline code if present")
    parser.add_argument("--disable_safety", action="store_true", help="Disable NSFW safety checker")
    parser.add_argument("--interactive", action="store_true", help="Keep the model loaded and accept multiple prompts in a REPL loop")
    parser.add_argument("--dbg-info", action="store_true", help="Print debug information about the loaded pipeline and model directory")
    parser.add_argument("--compare-schedulers", action="store_true", help="Generate and save outputs using multiple schedulers for comparison")
    return parser.parse_args()


def print_pipeline_debug_info(pipe, model_dir: str):
    try:
        print("--- Pipeline debug info ---")
        print("Tokenizer type:", type(getattr(pipe, "tokenizer", None)))
        try:
            tok = getattr(pipe, "tokenizer", None)
            if tok is not None:
                print(" tokenizer.model_max_length:", getattr(tok, "model_max_length", None))
                print(" tokenizer.vocab_size:", getattr(tok, "vocab_size", None))
        except Exception as _:
            pass
        print("Text encoder:", type(getattr(pipe, "text_encoder", None)))
        print("VAE:", type(getattr(pipe, "vae", None)))
        print("UNet:", type(getattr(pipe, "unet", None)))
        print("Scheduler:", type(getattr(pipe, "scheduler", None)))
        # show a short listing of model dir
        try:
            if model_dir and os.path.isdir(model_dir):
                entries = os.listdir(model_dir)
                print(f"Model dir ({model_dir}) listing (first 30 entries):", entries[:30])
        except Exception:
            pass
        print("--- end debug info ---")
    except Exception:
        print("Failed to print pipeline debug info")


def choose_device(requested: Optional[str]) -> torch.device:
    if requested in (None, "auto"):
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if requested == "cuda":
        return torch.device("cuda")
    return torch.device("cpu")


def load_pipeline(model_dir: str, device: torch.device, trust_remote_code: bool, lowvram: bool):
    local_only = os.path.isdir(model_dir)
    torch_dtype = torch.float16 if device.type == "cuda" else torch.float32

    load_kwargs = {
        "dtype": torch_dtype,
        "local_files_only": local_only,
    }
    if trust_remote_code:
        load_kwargs["trust_remote_code"] = True

    pipe = StableDiffusionPipeline.from_pretrained(model_dir, **load_kwargs)
    pipe = pipe.to(device)

    if lowvram:
        try:
            pipe.enable_attention_slicing()
        except Exception:
            pass
        try:
            pipe.enable_sequential_cpu_offload()
        except Exception:
            pass

    return pipe


def generate(prompt: str, out_path: str, model: str, height: int, width: int, steps: int, scale: float, device: torch.device, seed: Optional[int], lowvram: bool, trust_remote_code: bool, disable_safety: bool = False, pipe=None):
    # If a preloaded pipeline is provided, reuse it to avoid re-loading weights each call
    if pipe is None:
        pipe = load_pipeline(model, device, trust_remote_code, lowvram)

    # Optionally disable safety checker (ONLY use if you trust the model and prompts)
    if disable_safety:
        try:
            def _dummy_safety(images, **kwargs):
                return images, [False] * len(images)
            pipe.safety_checker = _dummy_safety
            print("Safety checker disabled (--disable_safety enabled).")
        except Exception:
            pass

    # Truncate the prompt if tokenizer reports it is longer than allowed
    try:
        tokenizer = getattr(pipe, "tokenizer", None)
        if tokenizer is not None:
            # Defensive: some tokenizers report an extremely large model_max_length
            # which will cause tokenizer.pad() to try to extend lists by a huge amount
            # and raise OverflowError. Detect absurd values and clamp to a sensible default.
            reported_max = getattr(tokenizer, "model_max_length", None)
            if reported_max is None:
                max_len = 77
            else:
                try:
                    max_len = int(reported_max)
                except Exception:
                    max_len = 77

            # If tokenizer reports an absurdly large or non-positive max, clamp to 77 (CLIP default)
            if max_len <= 0 or max_len > 4096:
                print(f"Warning: tokenizer.model_max_length={reported_max} looks invalid; using 77 instead to avoid padding overflow.")
                max_len = 77
                try:
                    tokenizer.model_max_length = max_len
                except Exception:
                    pass

            # encode using the tokenizer to get token length (no padding)
            encoded = tokenizer(prompt, add_special_tokens=True, return_tensors="pt")
            seq_len = encoded["input_ids"].shape[1]
            print(f"Tokenized length={seq_len}, tokenizer.model_max_length={max_len}")
            if seq_len > max_len:
                print(f"Prompt too long ({seq_len} > {max_len}), truncating to {max_len} tokens.")
                truncated_ids = encoded["input_ids"][0][:max_len]
                prompt = tokenizer.decode(truncated_ids, skip_special_tokens=True).strip()
    except Exception as e:
        # tokenization/truncation failed; continue with original prompt
        print(f"Warning: could not check/truncate prompt: {e}")

    gen = None
    if seed is not None:
        gen = torch.Generator(device=device).manual_seed(seed)

    res = pipe(prompt=prompt, height=height, width=width, num_inference_steps=steps, guidance_scale=scale, generator=gen)
    img = res.images[0]
    os.makedirs(os.path.dirname(os.path.abspath(out_path)) or ".", exist_ok=True)
    img.save(out_path)
    return out_path


def generate_with_schedulers(prompt: str, out_path_base: str, model: str, height: int, width: int, steps: int, scale: float, device: torch.device, seed: Optional[int], lowvram: bool, trust_remote_code: bool, disable_safety: bool = False, pipe=None):
    """Generate images using multiple schedulers and save with suffixes for comparison."""
    from diffusers import DPMSolverMultistepScheduler, EulerAncestralDiscreteScheduler

    if pipe is None:
        pipe = load_pipeline(model, device, trust_remote_code, lowvram)

    # Optionally disable safety checker
    if disable_safety:
        try:
            def _dummy_safety(images, **kwargs):
                return images, [False] * len(images)
            pipe.safety_checker = _dummy_safety
        except Exception:
            pass

    # Keep the original scheduler config
    base_config = pipe.scheduler.config

    outputs = []

    # DPMSolver
    try:
        pipe.scheduler = DPMSolverMultistepScheduler.from_config(base_config)
        out_path = f"{out_path_base}_dpmsolver.png"
        outputs.append(generate(prompt, out_path, model, height, width, steps, scale, device, seed, lowvram, trust_remote_code, disable_safety, pipe=pipe))
    except Exception as e:
        print("DPMSolver generation failed:", e)

    # Euler Ancestral
    try:
        pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(base_config)
        out_path = f"{out_path_base}_euler.png"
        outputs.append(generate(prompt, out_path, model, height, width, steps, scale, device, seed, lowvram, trust_remote_code, disable_safety, pipe=pipe))
    except Exception as e:
        print("Euler generation failed:", e)

    # DDIM (original)
    try:
        from diffusers import DDIMScheduler
        pipe.scheduler = DDIMScheduler.from_config(base_config)
        out_path = f"{out_path_base}_ddim.png"
        outputs.append(generate(prompt, out_path, model, height, width, steps, scale, device, seed, lowvram, trust_remote_code, disable_safety, pipe=pipe))
    except Exception as e:
        print("DDIM generation failed:", e)

    return outputs


def main():
    args = parse_args()
    device = choose_device(args.device)
    print(f"Using device: {device}")

    if not args.out:
        timestamp = datetime.now().strftime("%Y-%m-%d-%H-%M")
        out_path = f"sdv1_5_{timestamp}.png"
    else:
        out_path = args.out
    print("============args.interactive:", args.interactive)
    if args.interactive:
        # Load pipeline once and reuse
        pipe = load_pipeline(args.model, device, args.trust_remote_code, args.lowvram)
        if args.dbg_info:
            print_pipeline_debug_info(pipe, args.model)
        if args.disable_safety:
            try:
                def _dummy_safety(images, **kwargs):
                    return images, [False] * len(images)
                pipe.safety_checker = _dummy_safety
                print("Safety checker disabled (--disable_safety enabled).")
            except Exception:
                pass

        print("Entering interactive prompt mode. Type 'exit' or 'quit' to stop.")
        count = 0
        while True:
            try:
                user_prompt = input("prompt> ").strip()
            except (EOFError, KeyboardInterrupt):
                print("\nExiting interactive mode.")
                break
            if not user_prompt:
                continue
            if user_prompt.lower() in ("exit", "quit"):
                print("Exiting interactive mode.")
                break

            # build output filename using counter + timestamp
            timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            out_file = args.out or f"sdv1_5_{timestamp}_{count}.png"
            try:
                if args.compare_schedulers:
                    outs = generate_with_schedulers(
                        prompt=user_prompt,
                        out_path_base=os.path.splitext(out_file)[0],
                        model=args.model,
                        height=args.height,
                        width=args.width,
                        steps=args.steps,
                        scale=args.scale,
                        device=device,
                        seed=args.seed,
                        lowvram=args.lowvram,
                        trust_remote_code=args.trust_remote_code,
                        disable_safety=args.disable_safety,
                        pipe=pipe,
                    )
                    print("Saved images:", outs)
                else:
                    out = generate(
                        prompt=user_prompt,
                        out_path=out_file,
                        model=args.model,
                        height=args.height,
                        width=args.width,
                        steps=args.steps,
                        scale=args.scale,
                        device=device,
                        seed=args.seed,
                        lowvram=args.lowvram,
                        trust_remote_code=args.trust_remote_code,
                        disable_safety=args.disable_safety,
                        pipe=pipe,
                    )
                    print(f"Saved image to: {out}")
            except Exception as e:
                import traceback
                print("Generation failed:")
                traceback.print_exc()
            count += 1
    else:
        # Non-interactive: optionally load pipeline and print debug info before a single run
        if args.dbg_info:
            pipe = load_pipeline(args.model, device, args.trust_remote_code, args.lowvram)
            print_pipeline_debug_info(pipe, args.model)

        if args.compare_schedulers:
            base = os.path.splitext(out_path)[0]
            outs = generate_with_schedulers(
                prompt=args.prompt,
                out_path_base=base,
                model=args.model,
                height=args.height,
                width=args.width,
                steps=args.steps,
                scale=args.scale,
                device=device,
                seed=args.seed,
                lowvram=args.lowvram,
                trust_remote_code=args.trust_remote_code,
                disable_safety=args.disable_safety,
            )
            print("Saved images:", outs)
        else:
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
                lowvram=args.lowvram,
                trust_remote_code=args.trust_remote_code,
                disable_safety=args.disable_safety,
            )

            print(f"Saved image to: {out}")


if __name__ == "__main__":
    main()
