# 本地文本转音频（TTS）起点

这个工作区包含一个简单的 Python 脚本，用来调用本地的文本->音频模型。它优先尝试使用 ModelScope 的 pipeline 接口；如果没有安装 ModelScope 或 pipeline 不适配则会提示并保留回退点供你修改。

默认模型路径示例（你给出的路径）:
G:\AIModels\modelscope_cache\models\AI-ModelScope\audioldm2

安装依赖（PowerShell）:

```powershell
python -m pip install -r requirements.txt
# 如果需要 GPU 支持，请额外安装 torch: https://pytorch.org
```

运行示例（PowerShell）:

```powershell
python .\scripts\tts_local.py --model "G:\\AIModels\\modelscope_cache\\models\\AI-ModelScope\\audioldm2" --text "你好，世界" --out out.wav --device cpu
```

注意事项：
- 不同的 ModelScope 模型可能需要不同的 pipeline 名称或返回格式。如果脚本不能直接工作，请把模型的文档或推理示例发给我，我会帮你适配。
- 我在脚本中实现了一个 write_wav 的简单函数，保存为单声道 16-bit WAV。采样率默认 24000，可以根据模型输出调整。
