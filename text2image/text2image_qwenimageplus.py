import dashscope
from dashscope import ImageSynthesis
import requests
import os
from datetime import datetime

def generate_with_qwen_imageplus(prompt, save_path="qwen_image.png", api_key = None):
    """
    use qwen image_plus to generate image
    """
    # set api key
    if api_key:
        dashscope.api_key = api_key
    else:
        dashscope.api_key = os.getenv('DASHSCOPE_API_KEY')

    if not dashscope.api_key:
        raise ValueError("please provide dashscope api key.")

    try:
        # 调用api
        response = ImageSynthesis.call(
            # 测试发现 模型的名称可以到阿里百炼模型服务中查看；
            # qwen-image-plus 比ImageSynthesis.Models.wanx_v1好多了
            # qwen-image-plus（image2025-10-13-13-39.png）和qwen-image（image2025-10-13-13-41.png）效果差不多
            # model="qwen-image-plus",
            model="qwen-image",
            #ImageSynthesis.Models.wanx_v1,
            prompt=prompt,
            n=1,
            size="1328*1328"
        )
        if response.status_code == 200 and response.output.results:     
            image_url = response.output.results[0].url
            image_response = requests.get(image_url)
            with open(save_path, "wb") as f:
                f.write(image_response.content)
            print(f"image saved:path ={save_path}")
            return True
        else:
            print(f"{response} 生成失败或无结果.")
            return False
    except Exception as e:
        print(f"调用api出错。{e}")
        return False

if __name__ == "__main__":
    prompt = """欧洲野性风格女战士，淡蓝色眼眸清澈锐利，目光坚定直视前方；面容漂亮 高鼻梁 嘴唇饱满 头发被打湿，贴在前额和勃颈上 边缘的发梢还有水滴 
    身着野兽皮，皮毛依稀可见，手持战斧，斧刃在晨光下反射出高光 立于浑浊的水中正缓慢前进 胸部丰满 肌肉线条明显，水面及与膝盖
    背景是高大的杉木，黑绿色的藤蔓缠绕着树干 远处薄雾朦胧 隐约看到几只饿狼 4k 超高清"""
    generate_with_qwen_imageplus(prompt, "image" + datetime.now().strftime("%Y-%m-%d-%H-%M") + ".png")