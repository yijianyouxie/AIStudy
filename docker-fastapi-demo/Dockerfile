# 1. 选择基础镜像：基于 Python 3.10 精简版（体积小，适合生产环境）
FROM python:3.10-slim

# 2. 设置容器内的工作目录（所有后续命令都在 /app 下执行）
WORKDIR /app

# 3. 安装 Python 依赖：先复制 requirements.txt，再用 pip 安装
# （先复制依赖文件再安装，利用 Docker 缓存，后续改代码时无需重新安装依赖）
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 4. 复制本地的服务器代码到容器内的 /app 目录
COPY main.py .

# 5. 暴露容器内的端口：告诉 Docker 容器会用 8000 端口提供服务（仅声明，不映射）
EXPOSE 8000

# 6. 容器启动时执行的命令：用 uvicorn 启动 FastAPI 服务
# --host 0.0.0.0：允许容器外访问（否则只能容器内部访问）
# --port 8000：服务运行在 8000 端口（与 EXPOSE 一致）
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]