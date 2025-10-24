# 在当前文件夹下运行powershell
# 构建镜像
## docker build -t fastapi-demo:v1.0 .
## 查看当前镜像 docker images

# 容器启动
## docker run -d -p 8080:8000 --name my-fastapi-container fastapi-demo:v1.0
## 查看正在运行的容器 docker ps

# 本地网页访问
## http://localhost:8080



#======================================================================================
# 在win下的wsl中如何搭建服务然后在win本地进行访问
## 首先打开wsl，进行以下命令
sudo apt update
mkdir ~/fastapi-project
cd ~/fastapi-project
cp -r /mnt/g/AI/AIStudy/docker-fastapi-demo/main.py ~/fastapi-project/
cp -r /mnt/g/AI/AIStudy/docker-fastapi-demo/requirements.txt ~/fastapi-project/
## 接下来需要创建虚拟环境，因为Ubuntu 23.04 及更高版本默认启用了 PEP 668，防止用户直接使用 pip 在系统 Python 环境中安装包，以避免与系统包管理器冲突。
## 解决方案是使用 Python 虚拟环境。
### 创建虚拟环境
sudo apt update
sudo apt install python3-venv python3-full -y
cd ~/fastapi-project
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload