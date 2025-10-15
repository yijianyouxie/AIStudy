import os
# 彻底禁用所有网络连接
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["DIFFUSERS_OFFLINE"] = "1"

import torch
import warnings
warnings.filterwarnings("ignore")

from transformers import AutoModelForCausalLM, AutoTokenizer
from snac import SNAC
import scipy.io.wavfile
import numpy as np

print("=== 完全离线TTS系统启动 ===")

print("开始加载TTS模型...")
try:
    # 使用标准transformers加载模型，不使用Unsloth
    model = AutoModelForCausalLM.from_pretrained(
        r"G:\AIModels\modelscope_cache\models\Vyvo\VyvoTTS-LFM2-Jenny",
        torch_dtype=torch.float16,
        device_map="auto",
        trust_remote_code=True,
        local_files_only=True
    )
    tokenizer = AutoTokenizer.from_pretrained(
        r"G:\AIModels\modelscope_cache\models\Vyvo\VyvoTTS-LFM2-Jenny",
        trust_remote_code=True,
        local_files_only=True
    )
    print("✅ TTS模型加载完成")
except Exception as e:
    print(f"❌ TTS模型加载失败: {e}")
    exit(1)

print("加载SNAC声码器...")
try:
    snac_model = SNAC.from_pretrained(
        r"G:\AIModels\hf_cache\snac_24khz", 
        local_files_only=True
    )
    snac_model.to("cpu")
    snac_model.eval()
    print("✅ SNAC声码器加载完成")
except Exception as e:
    print(f"❌ SNAC模型加载失败: {e}")
    exit(1)

# 设置模型为评估模式
model.eval()

print("所有模型加载完成，开始处理文本...")

# 根据您的模型配置设置token
tokeniser_length = 64400
start_of_text = 1
end_of_text = 7
start_of_speech = tokeniser_length + 1
end_of_speech = tokeniser_length + 2
start_of_human = tokeniser_length + 3
end_of_human = tokeniser_length + 4
pad_token = tokeniser_length + 7
audio_tokens_start = tokeniser_length + 10

# 输入文本
prompts = ["Hi, My name is haibin2, and I'm a speech generation model that can sound like a person."]
chosen_voice = None

# 准备输入
prompts_ = [(f"{chosen_voice}: " + p) if chosen_voice else p for p in prompts]

all_input_ids = []
for prompt in prompts_:
    input_ids = tokenizer(prompt, return_tensors="pt").input_ids
    all_input_ids.append(input_ids)

start_token = torch.tensor([[start_of_human]], dtype=torch.int64)
end_tokens = torch.tensor([[end_of_text, end_of_human]], dtype=torch.int64)

all_modified_input_ids = []
for input_ids in all_input_ids:
    modified_input_ids = torch.cat([start_token, input_ids, end_tokens], dim=1)
    all_modified_input_ids.append(modified_input_ids)

# 填充序列
all_padded_tensors, all_attention_masks = [], []
max_length = max([m.shape[1] for m in all_modified_input_ids])
for m in all_modified_input_ids:
    padding = max_length - m.shape[1]
    padded_tensor = torch.cat([torch.full((1, padding), pad_token, dtype=torch.int64), m], dim=1)
    attention_mask = torch.cat([torch.zeros((1, padding), dtype=torch.int64), torch.ones((1, m.shape[1]), dtype=torch.int64)], dim=1)
    all_padded_tensors.append(padded_tensor)
    all_attention_masks.append(attention_mask)

input_ids = torch.cat(all_padded_tensors, dim=0).to(model.device)
attention_mask = torch.cat(all_attention_masks, dim=0).to(model.device)

print("开始生成音频token...")

# 生成音频token
with torch.no_grad():
    generated_ids = model.generate(
        input_ids=input_ids,
        attention_mask=attention_mask,
        max_new_tokens=800,
        do_sample=True,
        temperature=0.6,
        top_p=0.95,
        repetition_penalty=1.1,
        num_return_sequences=1,
        eos_token_id=end_of_speech,
        use_cache=True,
        pad_token_id=pad_token
    )

print("音频token生成完成，开始处理...")

# 处理生成的token
token_to_find = start_of_speech
token_to_remove = end_of_speech
token_indices = (generated_ids == token_to_find).nonzero(as_tuple=True)

if len(token_indices[1]) > 0:
    last_occurrence_idx = token_indices[1][-1].item()
    cropped_tensor = generated_ids[:, last_occurrence_idx+1:]
else:
    cropped_tensor = generated_ids

processed_rows = []
for row in cropped_tensor:
    masked_row = row[row != token_to_remove]
    processed_rows.append(masked_row)

code_lists = []
for row in processed_rows:
    row_length = row.size(0)
    new_length = (row_length // 7) * 7
    trimmed_row = row[:new_length]
    trimmed_row = [t - audio_tokens_start for t in trimmed_row]
    code_lists.append(trimmed_row)

def redistribute_codes(code_list):
    layer_1, layer_2, layer_3 = [], [], []
    for i in range((len(code_list)+1)//7):
        layer_1.append(code_list[7*i])
        layer_2.append(code_list[7*i+1]-4096)
        layer_3.append(code_list[7*i+2]-(2*4096))
        layer_3.append(code_list[7*i+3]-(3*4096))
        layer_2.append(code_list[7*i+4]-(4*4096))
        layer_3.append(code_list[7*i+5]-(5*4096))
        layer_3.append(code_list[7*i+6]-(6*4096))
    codes = [
        torch.tensor(layer_1).unsqueeze(0),
        torch.tensor(layer_2).unsqueeze(0),
        torch.tensor(layer_3).unsqueeze(0)
    ]
    audio_hat = snac_model.decode(codes)
    return audio_hat

print("开始解码音频...")

# 生成音频
my_samples = []
for i, code_list in enumerate(code_lists):
    print(f"解码音频 {i+1}/{len(code_lists)}...")
    samples = redistribute_codes(code_list)
    my_samples.append(samples)

# 保存音频文件
print("\n=== 音频生成结果 ===")
for i, (prompt, samples) in enumerate(zip(prompts, my_samples)):
    print(f"提示: {prompt}")
    
    # 保存为WAV文件
    output_file = f"generated_audio_{i}.wav"
    audio_data = samples.detach().squeeze().to("cpu").numpy()
    
    # 确保音频数据是正确格式
    if audio_data.dtype != np.int16:
        # 归一化并转换为16位PCM
        audio_data = np.int16(audio_data / np.max(np.abs(audio_data)) * 32767)
    
    scipy.io.wavfile.write(output_file, rate=24000, data=audio_data)
    print(f"✅ 音频已保存: {output_file}")
    
    # 显示音频信息
    duration = len(audio_data) / 24000
    print(f"音频时长: {duration:.2f}秒")
    print("-" * 50)

print("\n🎉 所有音频生成完成！")
print("您可以在当前目录找到生成的WAV文件")

# 清理内存
del my_samples, model, snac_model, tokenizer
if torch.cuda.is_available():
    torch.cuda.empty_cache()

print("内存清理完成")
print("=== 程序结束 ===")