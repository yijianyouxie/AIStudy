# 目前成功实现的文本转音频的脚本是text2audio_jenny_withtransformers.py
# text2audio.py和tts_local.py脚本都没有成功。
# requirements.txt是能够正确运行text2audio_jenny_withtransformers.py并生成音频需要的库文件

1. 环境初始化
设置离线模式环境变量，禁用所有网络连接

导入必要的库和模块

2. 模型加载阶段
python
# 加载两个核心模型：
# - TTS主模型 (VyvoTTS-LFM2-Jenny)
# - SNAC声码器 (音频解码器)
3. 文本预处理
定义特殊token（文本开始/结束、语音开始/结束等）

设置tokenizer参数和音频token起始位置

准备输入文本并添加可选的声音标识

4. 输入序列构建
python
# 关键步骤：
tokenizer编码文本 → 添加特殊token → 序列填充对齐 → 生成注意力掩码
5. 音频Token生成
python
# 使用自回归语言模型生成音频token
# 重要参数：
- max_new_tokens=800
- temperature=0.6 (控制随机性)
- top_p=0.95 (核采样)
- repetition_penalty=1.1 (避免重复)
6. Token后处理
定位并裁剪语音开始token之后的内容

移除语音结束token

调整序列长度为7的倍数（对应SNAC的编码结构）

7. 代码重分布
python
# 将一维token序列重新组织为SNAC所需的3层结构：
# - layer_1, layer_2, layer_3
# 每层有特定的偏移量调整
8. 音频解码
使用SNAC声码器将离散token转换为连续音频波形

SNAC负责将压缩的音频表示转换为可听的音频信号

9. 音频后处理与保存
python
# 关键操作：
音频数据分离 → 格式转换(int16 PCM) → 归一化 → WAV文件写入
# 采样率：24kHz
10. 资源清理
释放模型内存

清理GPU缓存（如果使用GPU）

技术特点
完全离线运行：不依赖任何网络连接

两阶段架构：文本→token→音频的生成流程

高质量声码器：SNAC提供高质量的音频重建

内存优化：使用float16精度和及时的资源释放

这个系统展示了现代神经TTS的典型架构，将文本理解与音频生成分离，通过离散token作为中间表示来实现高质量的语音合成。