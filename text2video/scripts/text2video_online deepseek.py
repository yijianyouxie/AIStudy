from http import HTTPStatus
from dashscope import VideoSynthesis
import dashscope
import os
import time
import requests

# 设置API端点（北京地域）
dashscope.base_http_api_url = 'https://dashscope.aliyuncs.com/api/v1'

# 设置API Key - 优先使用环境变量，如果没有则手动填写
api_key = os.getenv("DASHSCOPE_API_KEY", "你的API-KEY")

def generate_video_async(prompt, model='wan2.2-t2v-plus', size='832*480', output_file="generated_video.mp4"):
    """
    异步生成视频并等待结果
    """
    try:
        print("⏳ 正在提交视频生成任务...")
        
        # 提交异步任务
        rsp = VideoSynthesis.async_call(
            api_key=api_key,
            model=model,
            prompt=prompt,
            prompt_extend=True,
            size=size,
            negative_prompt="",
            watermark=False,
            seed=12345
        )
        
        if rsp.status_code != HTTPStatus.OK:
            print(f'❌ 任务提交失败: status_code: {rsp.status_code}, code: {rsp.code}, message: {rsp.message}')
            return False
        
        task_id = rsp.output.task_id
        print(f"✅ 任务提交成功! 任务ID: {task_id}")
        print("⚠️ 视频生成需要一些时间，请耐心等待...")
        
        # 轮询查询任务状态
        return wait_for_task_completion(task_id, output_file)
        
    except Exception as e:
        print(f"💥 发生异常: {str(e)}")
        return False

def wait_for_task_completion(task_id, output_file, max_attempts=60):
    """
    轮询查询任务状态 - 修正后的版本
    """
    attempt = 0
    
    while attempt < max_attempts:
        attempt += 1
        
        try:
            # 修正：使用正确的参数传递方式
            rsp = VideoSynthesis.fetch(
                task_id,  # 位置参数，不是关键字参数
                api_key=api_key
            )
            
            if rsp.status_code == HTTPStatus.OK:
                task_status = rsp.output.task_status
                
                if task_status == 'SUCCEEDED':
                    video_url = rsp.output.video_url
                    print(f"🎉 视频生成成功！")
                    print(f"📥 视频下载链接: {video_url}")
                    
                    # 下载视频
                    if download_video(video_url, output_file):
                        print(f"✅ 视频已保存为: {output_file}")
                        return True
                    else:
                        return False
                        
                elif task_status in ['PENDING', 'RUNNING']:
                    print(f"🔄 任务处理中... ({attempt}/{max_attempts})")
                    time.sleep(10)  # 等待10秒
                    
                elif task_status == 'FAILED':
                    print(f'❌ 任务执行失败: status_code: {rsp.status_code}, code: {rsp.code}, message: {rsp.message}')
                    return False
                else:
                    print(f"⚠️ 未知任务状态: {task_status}")
                    time.sleep(10)
            else:
                print(f'❌ 查询任务状态失败: status_code: {rsp.status_code}, code: {rsp.code}, message: {rsp.message}')
                time.sleep(10)
                
        except Exception as e:
            print(f"⚠️ 查询状态时出现异常: {str(e)}")
            time.sleep(10)
                
    print("⏰ 等待超时，视频生成时间过长")
    return False

def download_video(video_url, filename):
    """
    下载生成的视频到本地
    """
    try:
        print("📥 开始下载视频...")
        response = requests.get(video_url, stream=True)
        if response.status_code == 200:
            with open(filename, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            return True
        else:
            print(f"❌ 视频下载失败: HTTP {response.status_code}")
            return False
    except Exception as e:
        print(f"💥 下载视频时出错: {str(e)}")
        return False

def check_api_status():
    """
    检查API状态和可用性
    """
    print("🔍 检查API状态...")
    try:
        # 尝试一个简单的同步调用来测试API
        rsp = VideoSynthesis.call(
            api_key=api_key,
            model='wan2.2-t2v-plus',
            prompt='测试',  # 简短提示以减少资源消耗
            size='320*240',  # 小尺寸以减少生成时间
            prompt_extend=False
        )
        
        if rsp.status_code == HTTPStatus.OK:
            print("✅ API连接正常")
            return True
        else:
            print(f"❌ API连接问题: {rsp.code} - {rsp.message}")
            return False
    except Exception as e:
        print(f"❌ API检查失败: {str(e)}")
        return False

if __name__ == '__main__':
    # 首先检查API状态
    if not check_api_status():
        print("❌ API检查失败，请检查API Key和网络连接")
        exit(1)
    
    # 你的视频描述
    prompt = "一只小猫在月光下的草地上奔跑，身上有星星点点的光芒"
    
    print(f"🎬 开始生成视频: {prompt}")
    
    # 使用异步调用
    success = generate_video_async(
        prompt=prompt,
        model='wan2.2-t2v-plus',
        size='832*480',
        output_file="my_generated_video.mp4"
    )
    
    if success:
        print("✅ 视频生成和下载完成！")
    else:
        print("❌ 视频生成失败")