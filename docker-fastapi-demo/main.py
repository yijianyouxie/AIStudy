# main.py
from fastapi import FastAPI

# 创建 FastAPI 应用实例
app = FastAPI()

# 定义根路径接口（访问 http://localhost:8000 时触发）
@app.get("/")
def read_root():
    return {"message": "Hello Docker! 我是容器内的 FastAPI 服务器"}

# 定义带参数的接口（可选，用于测试更多功能）
@app.get("/greet/{name}")
def greet(name: str):
    return {"message": f"Hello {name}! 你成功访问了容器内的服务"}