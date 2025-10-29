from modelscope.pipelines import pipeline
from modelscope.models import Model

# 1. 本地模型路径
local_model_path = r"G:\AIModels\modelscope_cache\models\Wan-AI\Wan2___1-T2V-1___3B"

# 2. 显式加载模型（避免路径被错误解析）
model = Model.from_pretrained(local_model_path)

# 3. 初始化管道（传入加载好的模型对象，而非路径字符串）
pipe = pipeline(
    task="text-to-video-synthesis",
    model=model,  # 传入模型对象
    device="cuda:0"  # 设备指定
)

# 4. 输入提示词
prompt = "一只可爱的小猫在草地上追逐蝴蝶，背景是蓝天白云"

# 5. 生成视频
result = pipe({"text": prompt})

# 6. 保存视频
output_path = "generated_video.mp4"
with open(output_path, "wb") as f:
    f.write(result["output_video"])

print(f"视频已保存至：{output_path}")
    