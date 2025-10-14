# conda langchain
# local_text2img.py脚本是在本地的模型，一开始下载了MusePublic\489_ckpt_FLUX_1这个模型，但这模型不支持
# diffusers,所有又下载了black-forest-labs\FLUX___1-dev，并且使用local_flux_text2img.py脚本来操作，
# 但是这个模型在加载的时候太大了，无法加载。
# local_flux_text2img.py脚本是加载本地的flux模型的，但是flux模型太大，无法加载。
# text2image_qwenimageplus.py 这个脚本是通过在线调用千问百炼的文生图模型。

# Local text-to-image example

This small example shows how to run a local text-to-image generation using Hugging Face Diffusers.

Files added:
- `local_text2img.py` - CLI to run a Stable Diffusion pipeline locally.
- `requirements.txt` - Python dependencies to install.

Quick setup (Windows PowerShell):

```powershell
# create venv
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# install deps
pip install -r requirements.txt
```

Basic usage:

```powershell
python local_text2img.py "A fantasy landscape, sunrise over mountains" --out out.png --model runwayml/stable-diffusion-v1-5 --device auto
```

Notes:
- If you have a local folder with a model, pass its path to `--model`.
- For best performance use a CUDA-enabled GPU. The script will pick `cuda` if available when `--device auto`.
- This is a minimal example; you may want to enable xformers, BF16/FP16 optimizations, or other features for high performance.
