# 在当前文件夹下运行powershell
# 构建镜像
## docker build -t fastapi-demo:v1.0 .
## 查看当前镜像 docker images

# 容器启动
## docker run -d -p 8080:8000 --name my-fastapi-container fastapi-demo:v1.0
## 查看正在运行的容器 docker ps

# 本地网页访问
## http://localhost:8080