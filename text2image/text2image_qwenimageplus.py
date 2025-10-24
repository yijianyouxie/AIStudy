import dashscope
from dashscope import ImageSynthesis
import requests
import os
from datetime import datetime
import tkinter as tk
from tkinter import scrolledtext, messagebox, filedialog

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


class ImageGeneratorGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("Qwen Image Generator")
        self.root.geometry("600x600")
        
        # Create UI elements
        self.create_widgets()
        
    def create_widgets(self):
        # API Key frame
        api_key_frame = tk.Frame(self.root)
        api_key_frame.pack(pady=10, fill=tk.X, padx=20)
        
        tk.Label(api_key_frame, text="DashScope API Key:", font=("Arial", 10)).pack(anchor=tk.W)
        self.api_key_entry = tk.Entry(api_key_frame, width=50, show="*")
        self.api_key_entry.pack(fill=tk.X, pady=(5, 0))
        
        # Try to load API key from environment variable
        env_api_key = os.getenv('DASHSCOPE_API_KEY')
        if env_api_key:
            self.api_key_entry.insert(0, env_api_key)
            self.api_key_entry.config(state='readonly')
        
        # Prompt label
        prompt_label = tk.Label(self.root, text="请输入图像提示词:", font=("Arial", 12))
        prompt_label.pack(pady=(10, 5))
        
        # Prompt text area
        self.prompt_text = scrolledtext.ScrolledText(self.root, width=70, height=15, wrap=tk.WORD)
        self.prompt_text.pack(pady=5)
        
        # Default prompt
        default_prompt = """欧洲野性风格女战士，淡蓝色眼眸清澈锐利，目光坚定直视前方；面容漂亮 高鼻梁 嘴唇饱满 头发被打湿，贴在前额和勃颈上 边缘的发梢还有水滴 
        身着野兽皮，皮毛依稀可见，手持战斧，斧刃在晨光下反射出高光 立于浑浊的水中正缓慢前进 胸部丰满 肌肉线条明显，水面及与膝盖
        背景是高大的杉木，黑绿色的藤蔓缠绕着树干 远处薄雾朦胧 隐约看到几只饿狼 4k 超高清"""
        self.prompt_text.insert(tk.END, default_prompt)
        
        # File name frame
        filename_frame = tk.Frame(self.root)
        filename_frame.pack(pady=10)
        
        tk.Label(filename_frame, text="保存文件名:").pack(side=tk.LEFT)
        self.filename_entry = tk.Entry(filename_frame, width=30)
        self.filename_entry.insert(0, "image" + datetime.now().strftime("%Y-%m-%d-%H-%M") + ".png")
        self.filename_entry.pack(side=tk.LEFT, padx=(5, 0))
        
        # Browse button
        browse_button = tk.Button(filename_frame, text="浏览...", command=self.browse_file)
        browse_button.pack(side=tk.LEFT, padx=(5, 0))
        
        # Generate button
        generate_button = tk.Button(self.root, text="生成图像", command=self.generate_image, 
                                  bg="#4CAF50", fg="white", font=("Arial", 12, "bold"),
                                  padx=20, pady=10)
        generate_button.pack(pady=20)
        
    def browse_file(self):
        filename = filedialog.asksaveasfilename(defaultextension=".png",
                                              filetypes=[("PNG files", "*.png"),
                                                        ("All files", "*.*")])
        if filename:
            self.filename_entry.delete(0, tk.END)
            self.filename_entry.insert(0, filename)
    
    def generate_image(self):
        api_key = self.api_key_entry.get().strip()
        prompt = self.prompt_text.get("1.0", tk.END).strip()
        save_path = self.filename_entry.get().strip()
        
        if not api_key:
            messagebox.showerror("错误", "请输入DashScope API密钥!")
            return
            
        if not prompt:
            messagebox.showerror("错误", "请输入图像提示词!")
            return
            
        if not save_path:
            messagebox.showerror("错误", "请输入保存文件名!")
            return
            
        # Show generating message
        self.root.config(cursor="wait")
        self.root.update()
        
        try:
            success = generate_with_qwen_imageplus(prompt, save_path, api_key)
            if success:
                messagebox.showinfo("成功", f"图像已生成并保存至: {save_path}")
            else:
                messagebox.showerror("失败", "图像生成失败，请检查控制台输出获取更多信息。")
        except Exception as e:
            messagebox.showerror("错误", f"发生异常: {str(e)}")
        finally:
            self.root.config(cursor="")
            

def main():
    # Try to create GUI, fallback to command line if GUI fails
    try:
        root = tk.Tk()
        app = ImageGeneratorGUI(root)
        root.mainloop()
    except Exception as e:
        print(f"无法启动图形界面: {e}")
        print("使用命令行模式...")
        prompt = """欧洲野性风格女战士，淡蓝色眼眸清澈锐利，目光坚定直视前方；面容漂亮 高鼻梁 嘴唇饱满 头发被打湿，贴在前额和勃颈上 边缘的发梢还有水滴 
        身着野兽皮，皮毛依稀可见，手持战斧，斧刃在晨光下反射出高光 立于浑浊的水中正缓慢前进 胸部丰满 肌肉线条明显，水面及与膝盖
        背景是高大的杉木，黑绿色的藤蔓缠绕着树干 远处薄雾朦胧 隐约看到几只饿狼 4k 超高清"""
        generate_with_qwen_imageplus(prompt, "image" + datetime.now().strftime("%Y-%m-%d-%H-%M") + ".png")


if __name__ == "__main__":
    main()