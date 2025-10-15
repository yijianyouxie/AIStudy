import torch
from cosyvoice.api import init_model, get_tts
from cosyvoice import load_audio

# 初始化模型
model = init_model(
    model_name=r"G:\AIModels\modelscope_cache\models\iic\CosyVoice2-0___5B",
    device="cuda"  # 使用GPU
)

# 生成音频
text = "你好，这是一个文本生成音频的测试。"
audio = get_tts(model, text, "zh-CN", 0.5)

# 保存音频
output_path = "output.wav"
torch.save(audio, output_path)

print(f"音频已保存至: {output_path}")
print("生成完成！")

# 可选：播放音频（需要安装pydub）
try:
    from pydub import AudioSegment
    AudioSegment.from_wav(output_path).export("output.mp3", format="mp3")
    print("音频已转换为MP3格式")
except ImportError:
    print("请安装pydub以播放音频: pip install pydub")