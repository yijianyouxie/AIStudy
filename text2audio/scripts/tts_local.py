"""
简单的本地文本->音频脚本。
- 优先尝试使用 AudioLDM2 原生加载（需 diffusers 库）。
- 回退到 ModelScope pipeline。

用法示例:
python tts_local.py --text "我是一条小青龙" --use-native --out output.wav
"""

import argparse
import wave
import torch


def write_wav(path: str, samples, sample_rate: int = 24000):
    """保存 PCM16 单声道 wav 文件"""
    import numpy as np

    if isinstance(samples, bytes):
        data = samples
    else:
        arr = np.asarray(samples)
        # 归一化到 int16
        if arr.dtype != np.int16:
            if np.issubdtype(arr.dtype, np.floating):
                arr = (arr * 32767).astype(np.int16)
            else:
                arr = arr.astype(np.int16)
        # 转为单声道
        if arr.ndim > 1:
            arr = arr.mean(axis=1).astype(np.int16)
        data = arr.tobytes()

    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(data)


def tts_with_modelscope(model_path: str, text: str, device: str = "cpu"):
    """使用 ModelScope pipeline 合成音频"""
    try:
        from modelscope.pipelines import pipeline
    except Exception as e:
        hint = "To fix: python -m pip install modelscope addict"
        raise RuntimeError(f"modelscope 导入失败: {e}. {hint}")

    # 仅尝试已知存在的任务名
    pipeline_names_to_try = ['text-to-audio', 'audioldm2']
    last_err = None
    tts = None
    for name in pipeline_names_to_try:
        try:
            try:
                tts = pipeline(name, model=model_path, device=device)
            except TypeError:
                tts = pipeline(name, model=model_path)
            print(f"使用 ModelScope pipeline: {name}")
            break
        except Exception as e:
            last_err = e
    if tts is None:
        raise RuntimeError(f"无法加载 ModelScope pipeline: {last_err}")

    # 执行合成
    out = tts(text)
    if isinstance(out, dict):
        audio = out.get('audio') or out.get('output_wav')
        sr = out.get('sampling_rate') or 24000
        if audio is None:
            raise RuntimeError(f"ModelScope 输出无音频字段: {out.keys()}")
    else:
        raise RuntimeError(f"不支持的 ModelScope 输出格式: {type(out)}")

    return audio, sr


def load_audioldm2(model_id_or_path: str, device: str = 'cpu', half: bool = True):
    """加载 AudioLDM2 原生 pipeline（适配旧版本 diffusers）"""
    try:
        from diffusers import AudioLDM2Pipeline
    except ImportError as e:
        raise RuntimeError(f"请安装兼容版本: pip install diffusers==0.25.1. 错误: {e}")

    # 移除不支持的参数（旧版本兼容）
    pipe = AudioLDM2Pipeline.from_pretrained(model_id_or_path)

    # 手动设置精度
    dtype = torch.float16 if (half and device.startswith('cuda')) else torch.float32
    pipe = pipe.to(dtype)

    # 移动到目标设备
    try:
        pipe = pipe.to(device)
    except Exception as e:
        print(f"警告: 模型移动到设备 {device} 失败: {e}")

    return pipe


def tts_with_audioldm2(pipe, text: str, **kwargs):
    """使用 AudioLDM2 原生 pipeline 合成（适配旧版本参数）"""
    # 旧版本参数名：duration（秒）、prompt（文本）
    params = {
        "prompt": text,
        "duration": 10,  # 音频时长
        "guidance_scale": 3.5,
        "sampling_rate": 24000,** kwargs
    }
    out = pipe(**params)
    return out["audios"][0], params["sampling_rate"]


def resolve_device(device_str: str):
    """解析设备参数"""
    d = (device_str or '').lower()
    if d in ('auto', 'gpu'):
        return 'cuda' if torch.cuda.is_available() else 'cpu'
    return 'cuda' if d.startswith('cuda') else 'cpu'


DEFAULT_MODEL_PATH = r"G:\AIModels\modelscope_cache\models\AI-ModelScope\audioldm2"


def main():
    parser = argparse.ArgumentParser(description='本地文本转音频工具')
    parser.add_argument('--model', default=DEFAULT_MODEL_PATH, help='模型路径')
    parser.add_argument('--text', required=True, help='合成文本')
    parser.add_argument('--out', default='out.wav', help='输出文件')
    parser.add_argument('--device', default='auto', help='设备（cpu/cuda/auto）')
    parser.add_argument('--use-native', action='store_true', help='使用原生 AudioLDM2 加载')
    args = parser.parse_args()

    device = resolve_device(args.device)
    print(f"使用设备: {device}")

    # 优先原生加载
    if args.use_native:
        try:
            pipe = load_audioldm2(args.model, device=device)
            samples, sr = tts_with_audioldm2(pipe, args.text)
            write_wav(args.out, samples, sr)
            print(f"原生方式合成成功，已保存到 {args.out}")
            return
        except Exception as e:
            print(f"原生方式失败: {e}")

    # 回退到 ModelScope
    try:
        samples, sr = tts_with_modelscope(args.model, args.text, device=device)
        write_wav(args.out, samples, sr)
        print(f"ModelScope 合成成功，已保存到 {args.out}")
        return
    except Exception as e:
        print(f"ModelScope 失败: {e}")

    print("所有方式均失败，请检查模型和依赖。")


if __name__ == '__main__':
    main()
