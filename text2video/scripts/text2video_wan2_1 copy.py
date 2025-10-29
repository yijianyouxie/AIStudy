# text2video_wan_fixed.py
import torch
import os
import json
import glob

def create_correct_model_index(model_path):
    """创建正确的模型配置文件"""
    
    # 检查模型文件
    safetensors_files = glob.glob(os.path.join(model_path, "*.safetensors"))
    pth_files = glob.glob(os.path.join(model_path, "*.pth"))
    config_files = glob.glob(os.path.join(model_path, "*.json"))
    
    print("找到的模型文件:")
    for f in safetensors_files + pth_files + config_files:
        if os.path.exists(f):
            size = os.path.getsize(f) / (1024**3) if f.endswith(('.safetensors', '.pth')) else 0
            size_str = f" ({size:.2f} GB)" if size > 0 else ""
            print(f"  ✅ {os.path.basename(f)}{size_str}")
    
    # 读取现有的 config.json 来了解模型结构
    config_path = os.path.join(model_path, "config.json")
    if os.path.exists(config_path):
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
        print(f"模型类型: {config.get('_class_name', 'Unknown')}")
    
    # 创建正确的 model_index.json
    # 对于通义万相模型，可能需要特定的 Pipeline 类
    model_index = {
        "_class_name": "WanPipeline",  # 尝试使用模型特定的 Pipeline
        "_diffusers_version": "0.21.4",
    }
    
    model_index_path = os.path.join(model_path, "model_index.json")
    with open(model_index_path, 'w', encoding='utf-8') as f:
        json.dump(model_index, f, indent=2, ensure_ascii=False)
    
    print(f"✅ 已创建 model_index.json")
    return True

def main():
    # 检查GPU
    device = "cuda" if torch.cuda.is_available() else "cpu"
    torch.cuda.empty_cache()
    
    print(f"使用设备: {device}")
    if device == "cuda":
        print(f"GPU: {torch.cuda.get_device_name(0)}")
        print(f"可用显存: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")
    
    # 模型路径
    model_path = r"G:\AIModels\modelscope_cache\models\Wan-AI\Wan2___1-T2V-1___3B"
    
    if not os.path.exists(model_path):
        print(f"错误: 模型路径不存在: {model_path}")
        return
    
    # 创建正确的配置文件
    if not create_correct_model_index(model_path):
        return
    
    try:
        print("正在加载模型...")
        
        # 方法1：尝试使用 AutoPipeline
        from diffusers import AutoPipeline
        
        pipe = AutoPipeline.from_pretrained(
            model_path,
            torch_dtype=torch.float16,
            trust_remote_code=True,
            local_files_only=True
        )
        pipe = pipe.to(device)
        
        print("✅ 使用 AutoPipeline 加载成功!")
        
    except Exception as e:
        print(f"AutoPipeline 加载失败: {e}")
        
        # 方法2：尝试直接使用 DiffusionPipeline，但简化配置
        try:
            from diffusers import DiffusionPipeline
            
            # 创建一个更简单的 model_index.json
            simple_model_index = {
                "_class_name": "DiffusionPipeline",
                "_diffusers_version": "0.21.4"
            }
            
            model_index_path = os.path.join(model_path, "model_index.json")
            with open(model_index_path, 'w', encoding='utf-8') as f:
                json.dump(simple_model_index, f, indent=2, ensure_ascii=False)
            
            print("尝试简化配置...")
            pipe = DiffusionPipeline.from_pretrained(
                model_path,
                torch_dtype=torch.float16,
                trust_remote_code=True,
                local_files_only=True
            )
            pipe = pipe.to(device)
            print("✅ 使用简化配置加载成功!")
            
        except Exception as e2:
            print(f"简化配置也失败: {e2}")
            
            # 方法3：尝试手动加载组件
            try:
                print("尝试手动加载组件...")
                from diffusers import DDIMScheduler, UNet3DConditionModel, AutoencoderKL
                from transformers import T5Tokenizer, T5EncoderModel
                import torch.nn as nn
                
                # 手动加载各个组件
                scheduler = DDIMScheduler.from_pretrained(model_path, subfolder="scheduler", local_files_only=True)
                
                # 加载文本编码器
                text_encoder = T5EncoderModel.from_pretrained(
                    "google-t5/t5-large",  # 使用标准的 T5 模型
                    torch_dtype=torch.float16
                )
                tokenizer = T5Tokenizer.from_pretrained("google-t5/t5-large")
                
                # 加载 UNet
                unet_config_path = os.path.join(model_path, "config.json")
                with open(unet_config_path, 'r') as f:
                    unet_config = json.load(f)
                
                unet = UNet3DConditionModel.from_pretrained(
                    model_path,
                    subfolder="unet",
                    torch_dtype=torch.float16,
                    local_files_only=True
                )
                
                # 加载 VAE
                vae_path = os.path.join(model_path, "Wan2.1_VAE.pth")
                vae = AutoencoderKL.from_pretrained(
                    model_path,
                    subfolder="vae", 
                    torch_dtype=torch.float16,
                    local_files_only=True
                )
                
                # 创建自定义 Pipeline
                from diffusers import DiffusionPipeline
                
                class CustomWanPipeline(DiffusionPipeline):
                    def __init__(self, vae, text_encoder, tokenizer, unet, scheduler):
                        super().__init__()
                        self.register_modules(
                            vae=vae,
                            text_encoder=text_encoder,
                            tokenizer=tokenizer,
                            unet=unet,
                            scheduler=scheduler
                        )
                    
                    def __call__(self, prompt, **kwargs):
                        # 这里需要实现具体的前向逻辑
                        # 由于复杂，这里只是框架
                        pass
                
                pipe = CustomWanPipeline(
                    vae=vae,
                    text_encoder=text_encoder,
                    tokenizer=tokenizer,
                    unet=unet,
                    scheduler=scheduler
                )
                pipe = pipe.to(device)
                print("✅ 手动加载组件成功!")
                
            except Exception as e3:
                print(f"手动加载也失败: {e3}")
                print("所有方法都失败了，请检查模型完整性")
                return
    
    # 如果成功加载，继续生成视频
    if 'pipe' in locals():
        try:
            # 启用内存优化
            try:
                if hasattr(pipe, 'enable_model_cpu_offload'):
                    pipe.enable_model_cpu_offload()
                if hasattr(pipe, 'enable_vae_slicing'):
                    pipe.enable_vae_slicing()
                print("✅ 内存优化已启用")
            except Exception as e:
                print(f"⚠️ 内存优化设置失败: {e}")
            
            # 生成视频
            prompt = "一只可爱的小猫在玩耍"
            print(f"开始生成视频: {prompt}")
            
            try:
                # 使用保守参数
                video_frames = pipe(
                    prompt,
                    num_inference_steps=15,
                    height=384,
                    width=640,
                    num_frames=12,
                ).frames
                
                # 保存视频
                from diffusers.utils import export_to_video
                output_path = "generated_video_fixed.mp4"
                export_to_video(video_frames, output_path)
                print(f"✅ 视频已成功生成: '{output_path}'")
                
            except Exception as e:
                print(f"❌ 视频生成失败: {e}")
                
        except Exception as e:
            print(f"❌ 运行失败: {e}")

if __name__ == "__main__":
    main()