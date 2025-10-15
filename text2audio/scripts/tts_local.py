"""
简单的本地文本->音频脚本。
- 优先尝试使用 ModelScope 的推理接口（如果安装了 modelscope 库）。
- 回退到 PyTorch 加载模型（占位实现，具体取决于模型库）。

用法示例（PowerShell）:
python .\\scripts\\tts_local.py --model "G:\\AIModels\\modelscope_cache\\models\\AI-ModelScope\\audioldm2" --text "你好，世界" --out out.wav --device cpu
"""

import argparse
import os
import sys
import wave


def write_wav(path: str, samples, sample_rate: int = 24000):
    """保存 PCM16 的单声道 wav 文件。
    samples: 1-D numpy array 或 bytes
    """
    import numpy as np

    if isinstance(samples, bytes):
        data = samples
    else:
        arr = np.asarray(samples)
        # 归一化到 int16
        if arr.dtype != np.int16:
            # 假设浮点在 -1..1
            if np.issubdtype(arr.dtype, np.floating):
                arr = (arr * 32767).astype(np.int16)
            else:
                arr = arr.astype(np.int16)
        data = arr.tobytes()

    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(data)


def tts_with_modelscope(model_path: str, text: str, device: str = "cpu"):
    """尝试使用 modelscope 的 pipeline 来合成音频。
    返回 (samples_np, sample_rate)
    """
    try:
        from modelscope.pipelines import pipeline
    except Exception as e:
        # Provide a helpful hint when modelscope or its deps are missing (e.g. 'addict')
        hint = "To fix: python -m pip install modelscope addict"
        raise RuntimeError("modelscope not available or cannot be imported: %s. %s" % (e, hint))

    # 这里我们假设 modelscope 的 tts pipeline 名称是 'text-to-audio' 或类似。
    # 有些 ModelScope 模型可能使用不同的 pipeline 名称（例如 'audio_synthesis' 等），
    # 如果加载失败，请检查模型说明并传入正确的 pipeline 名称或把模型文档发给我。
    pipeline_names_to_try = ['text-to-audio', 'audioldm', 'audio_synthesis', 'text2audio']
    last_err = None
    tts = None
    for name in pipeline_names_to_try:
        try:
            try:
                tts = pipeline(name, model=model_path, device=device)
            except TypeError:
                # 有些旧版 pipeline 可能不接受 device 参数
                tts = pipeline(name, model=model_path)
            print(f"使用 pipeline 名称: {name}")
            break
        except Exception as e:
            last_err = e
            # 尝试下一个名字
            tts = None
    if tts is None:
        raise RuntimeError(f"无法用任何已知 pipeline 名称加载模型: {last_err}")

    # 推断
    out = tts(text)
    # modelscope 的输出格式可能不同，尝试处理常见格式
    if isinstance(out, dict):
        # 常见 key: 'audio', 'waveform', 'output'
        for key in ('audio', 'waveform', 'wave', 'output'):
            if key in out:
                audio = out[key]
                break
        else:
            raise RuntimeError('无法从 modelscope 输出中找到音频字段: %s' % out.keys())
    else:
        audio = out

    # audio 可能是 numpy array 或 bytes 或 dict{ 'array':..., 'sampling_rate':... }
    sr = 24000
    if isinstance(audio, dict):
        samples = audio.get('array') or audio.get('waveform') or audio.get('audio')
        sr = audio.get('sampling_rate') or audio.get('sample_rate') or sr
    elif isinstance(audio, bytes):
        # 无法直接推断 sr，返回 bytes
        return audio, sr
    else:
        samples = audio

    return samples, sr


def load_audioldm2(model_id_or_path: str, device: str = 'cpu', half: bool = True):
    """按你给出的示例加载 AudioLDM2 风格的 pipeline（如果可用）。
    model_id_or_path 可以是本地路径或远程 id（例如 'cvssp/audioldm2'）。
    返回 pipeline 对象。
    """
    try:
        # 这里假设存在一个 AudioLDM2Pipeline 类（来自相应库，例如 audioldm 或 diffusers 扩展）
        from audioldm import AudioLDM2Pipeline
    except Exception as e:
        raise RuntimeError(f"无法导入 AudioLDM2Pipeline（请安装对应库）：{e}")

    import torch

    dtype = torch.float16 if half else torch.float32
    pipe = AudioLDM2Pipeline.from_pretrained(model_id_or_path, torch_dtype=dtype)

    # 将 pipeline 移到目标设备
    try:
        # 如果 device 是类似 'cuda' 或 'cuda:0'，把 pipe 移动到 CUDA
        pipe = pipe.to(device)
    except Exception:
        # 有些 pipeline 不支持 .to()，跳过
        pass

    # 尝试启用内存优化（如果 pipeline 有这些方法）
    for fn in ('enable_attention_slicing', 'enable_vae_slicing'):
        if hasattr(pipe, fn):
            try:
                getattr(pipe, fn)()
            except Exception:
                pass

    return pipe


def tts_with_audioldm2(pipe, text: str, **kwargs):
    """使用 AudioLDM2 风格的 pipeline 合成音频。返回 (samples, sample_rate)
    这里的实现是通用占位：具体返回类型取决于 pipeline 的实现。
    """
    # 大多数 pipeline 支持直接调用得到结果，例: out = pipe(text)
    out = pipe(text, **kwargs)

    # 处理常见返回值
    if isinstance(out, dict):
        # 常见 keys
        for key in ('audio', 'waveform', 'wav', 'samples'):
            if key in out:
                audio = out[key]
                break
        else:
            # 如果 dict 中可能包含 'audio' 作为对象
            audio = out
    else:
        audio = out

    # 尝试解析采样率和数组
    sr = 24000
    samples = None
    if isinstance(audio, dict):
        samples = audio.get('array') or audio.get('audio') or audio.get('samples')
        sr = audio.get('sampling_rate') or audio.get('sample_rate') or sr
    elif hasattr(audio, 'numpy'):
        samples = audio.numpy()
    else:
        samples = audio

    return samples, sr


def resolve_device(device_str: str):
    """解析用户给定的 device 字符串，返回 ('cuda'或'cpu', device_for_modelscope)
    device_for_modelscope: modelscope pipeline 可能接受 int (GPU id) 或 'cpu'/'cuda'
    返回 (torch_device_str, modelscope_device_arg)
    """
    d = (device_str or '').lower()
    # 支持 'auto'
    if d == 'auto' or d == 'gpu':
        # 检查是否有可用的 CUDA
        try:
            import torch
            if torch.cuda.is_available():
                return 'cuda', 0
            else:
                return 'cpu', 'cpu'
        except Exception:
            return 'cpu', 'cpu'

    if d.startswith('cuda'):
        # 支持 'cuda' 或 'cuda:0'
        parts = d.split(':')
        if len(parts) == 1:
            return 'cuda', 0
        try:
            idx = int(parts[1])
            return f'cuda:{idx}', idx
        except Exception:
            return 'cuda', 0

    return 'cpu', 'cpu'


DEFAULT_MODEL_PATH = r"G:\AIModels\modelscope_cache\models\AI-ModelScope\audioldm2"


def main():
    parser = argparse.ArgumentParser(description='Local TTS runner')
    parser.add_argument('--model', required=False, default=DEFAULT_MODEL_PATH, help='本地模型路径（可选，默认已硬编码）')
    parser.add_argument('--text', required=True, help='要合成的文本')
    parser.add_argument('--out', default='out.wav', help='输出 wav 文件')
    parser.add_argument('--device', default='cpu', help='device: cpu or gpu (cuda)')
    args = parser.parse_args()

    model_path = args.model
    text = args.text
    out_path = args.out
    device = args.device
    # 解析 device
    torch_device, modelscope_device = resolve_device(device)

    # 首先尝试使用 AudioLDM2 风格的加载（如果库可用）
    # try:
    #     use_half = torch_device.startswith('cuda')
    #     try:
    #         pipe = load_audioldm2(model_path, device=torch_device, half=use_half)
    #         samples, sr = tts_with_audioldm2(pipe, text)
    #         print(f"AudioLDM2 合成成功，采样率={sr}")
    #         write_wav(out_path, samples, sample_rate=sr)
    #         print(f"已保存到 {out_path}")
    #         return
    #     except Exception as e:
    #         print("AudioLDM2 合成/加载失败：", e)
    # except Exception:
    #     # load_audioldm2 在导入失败时会抛错，继续回退
    #     pass

    # 回退到 ModelScope pipeline（如果可用）
    try:
        # modelscope pipeline 可能接受 gpu id (int) 或 'cpu'
        samples, sr = tts_with_modelscope(model_path, text, device=modelscope_device)
        print(f"ModelScope 合成成功，采样率={sr}")
        write_wav(out_path, samples, sample_rate=sr)
        print(f"已保存到 {out_path}")
        return
    except Exception as e:
        print("ModelScope 合成失败：", e)

    # 回退：用户可以根据模型具体情况修改这里的实现
    print("所有尝试均失败。请检查依赖（audioldm / modelscope / torch）是否安装，或把模型目录和错误信息发给我以便进一步排查。")


if __name__ == '__main__':
    main()
