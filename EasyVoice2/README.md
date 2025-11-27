# EasyVoice 🎙️

## 项目简介 ✨  

**EasyVoice** 是一个开源的文本、小说智能转语音解决方案，旨在帮助用户轻松将文本内容转换为高质量的语音输出。  

- **一键生成语音和字幕**

- **AI 智能推荐配音**

- **完全免费，无时长、无字数限制**

- **支持将 10 万字以上的小说一键转为有声书！**

- **流式传输，多长的文本都能立刻播放**

- **支持自定义多角色配音**

无论你是想听小说、为创作配音，还是打造个性化音频，EasyVoice 都是你的最佳助手！

**你可以轻松的将 EasyVoice 部署到你的云服务器或者本地！**

## 体验一下

[easyvoice.ioplus.tech](https://easyvoice.ioplus.tech)

## 核心功能 🌟

- **文本转语音** 📝 ➡️ 🎵  
  一键将大段文本转为语音，高效又省时。
- **流式传输** 🌊  
  再多的文本，都可以迅速返回音频直接开始试听！
- **多语言支持** 🌍  
  支持中文、英文等多种语言。  
- **字幕支持** 💬  
  自动生成字幕文件，方便视频制作和字幕翻译。  
- **角色配音** 🎭  
  提供多种声音选项，完美适配不同角色。  
- **自定义设置** ⚙️  
  可调整语速、音调等参数，打造专属语音风格。  
- **AI 推荐** 🧠  
  通过 AI 智能推荐最适合的语音配置，省心又贴心。  
- **试听功能** 🎧  
  生成前可试听效果，确保每一句都如你所愿！  

## Screenshots📸

![Home](./images/readme.home.jpg)
![Generate](./images/readme.generate.jpg)

## 快速开始 🚀

### 1. 通过 docker 运行

```bash
# 极简运行，你可以通过 -e 指定环境变量
docker run -d -p 3000:3000 -v $(pwd)/audio:/app/audio cosincox/easyvoice:latest
```

or 将仓库克隆到本地，使用 Docker Compose 一键运行！

```bash
docker-compose up -d
```

### 2. 本地运行项目（请先确保已安装 Node.js 环境，参考：[安装 Node.js](https://zhuanlan.zhihu.com/p/442215189)）

```bash
# 开启/安装 pnpm
corepack enable
# 或者使用 npm 安装 pnpm
npm install -g pnpm

# 克隆仓库
git clone git@github.com:cosin2077/easyVoice.git
cd easyVoice
# 安装依赖
pnpm i -r

# 开发模式
pnpm dev:root

# 生产模式
pnpm build:root
pnpm start:root
```

### 3. 生成的音频、字幕保存位置

- Docker 部署： 保存在挂载的 `audio` 目录下
- Node.js 运行保存在 `./packages/backend/audio` 目录下

## 高级

### 角色自定义

启动服务后尝试在命令行运行下述命令：

```bash
curl -X POST http://localhost:3000/api/v1/tts/generateJson \
  -H "Content-Type: application/json" \
  -d '{
  "data": [
    {
      "desc": "徐凤年",
      "text": "你敢动他，我会穷尽一生毁掉卢家，说到做到",
      "voice": "zh-CN-YunjianNeural",
      "volume": "40%"
    },
    {
      "desc": "姜泥",
      "text": "徐凤年，你快走，你打不过的",
      "voice": "zh-CN-XiaoyiNeural"
    },
    {
      "desc": "路人甲",
      "text": "他可是堂堂棠溪剑仙，这小子真是遇到强敌了",
      "voice": "zh-CN-XiaoniNeural",
      "volume": "-20%"
    },
    {
      "desc": "路人乙",
      "text": "这小子真是不知死活，竟然敢挑战卢白撷",
      "voice": "zh-TW-HsiaoChenNeural",
      "volume": "-20%"
    },
    {
      "desc": "旁白",
      "text": "面对棠溪剑仙卢白撷的杀意，徐凤年按住剑柄蓄势待发，他将姜泥放在心尖上，话锋一句比一句犀利，威逼利诱的要求卢白撷放姜泥一条生路。卢白撷也是不撞南墙不回头的人，他与西楚有深仇大恨不得不报...",
      "voice": "zh-CN-YunxiNeural",
      "rate": "0%",
      "pitch": "0Hz",
      "volume": "0%"
    },
    {
      "desc": "旁白",
      "text": "卢白撷凝聚剑气，剑光如虹，直指姜泥。剑气快到姜泥的时候，竟然被一颗小石子打破！万千剑气瞬间消散。居然就是刚刚进入山门的青衣男子。卢白撷心中警铃大作，再次凝结千万水剑想要先下手为强，青衣男子竟然一只手就挡下了，随之飓风盘起，竟然有山呼海啸之势，众人分分被逼退。随后的打斗，青衣男子每一步都精准预测了卢白撷的动作，卢白撷心中惊骇不已。",
      "voice": "zh-CN-YunxiNeural",
      "rate": "0%",
      "pitch": "0Hz",
      "volume": "0%"
    },
    {
      "desc": "卢白撷",
      "text": "人心入局，观子无敌，棋局未央，棋子难逃。你是！？ 曹长卿！",
      "voice": "zh-CN-YunyangNeural",
      "rate": "-2%",
      "pitch": "2Hz",
      "volume": "10%"
    }
  ]
}' \
-o output.mp3

```

你将看到output.mp3文件的生成，并立即可以播放。

#### 参数说明

- text: 你需要转语音的文字。
- voice: 你需要用到的声音，参考：[支持的声音列表](./packages/backend/src/llm/prompt/voiceList.json)
- rate: 语速调整，百分比形式，默认 +0%（正常），如 "+50%"（加快 50%），"-20%"（减慢 20%）。
- volume: 音量调整，百分比形式，默认 +0%（正常），如 "+20%"（增 20%），"-10%"（减 10%）。
- pitch: 音调调整，默认 +0Hz（正常），如 "+10Hz"（提高 10 赫兹），"-5Hz"（降低 5 赫兹）。

### 接入其他 TTS 服务

- TODO

## 技术实现 🛠️

- **前端**：Vue 3 + TypeScript + Element Plus 🌐  
- **后端**：Node.js + Express + TypeScript ⚡  
- **语音合成**：Microsoft Azure TTS(更多引擎接入中) + OpenAI(OpenAI 兼容即可) + ffmpeg 🎤  
- **部署**：Node.js + Docker + Docker Compose 🐳  

## 快速开发 🚀

1.克隆仓库

```bash
git clone https://github.com/cosin2077/easyVoice.git
```

2.安装依赖

```bash
pnpm i -r
```

3.启动项目

```bash
pnpm dev
```

4.打开浏览器，访问 `http://localhost:5173/`，开始体验吧！

## 环境变量 ⚙️

| 变量名              | 默认值                         | 描述                          |
|--------------------|-------------------------------|------------------------------|
| `PORT`             | `3000`                        | 服务端口                      |
| `OPENAI_BASE_URL`  | `https://api.openai.com/v1`   | OpenAI 兼容 API 地址          |
| `OPENAI_API_KEY`   | -                             | OpenAI API Key               |
| `MODEL_NAME`       | -                             | 使用的模型名称                 |
| `RATE_LIMIT_WINDOW`| `1`                           | 速率限制窗口大小（分钟）         |
| `RATE_LIMIT`       | `10`                          | 速率限制次数                   |
| `EDGE_API_LIMIT`   | `3`                           | Edge-TTS API 并发数           |

- **配置文件**：可在 `.env` 或 `packages/backend/.env` 中设置，优先级为 `packages/backend/.env > .env`。  
- **Docker 配置**：通过 `-e` 参数传入环境变量，如上文示例。

## FAQ

- **Q: 如何配置 OpenAI 相关信息?**
- A: 在 `.env` 文件中添加 `OPENAI_API_KEY=your_api_key` `OPENAI_BASE_URL=openai_compatible_base_url` `MODEL_NAME=openai_model_name`，你可以用任何 openai compatible 的 API 地址和模型名称，例如 `https://openrouter.ai/api/v1/` 和 `deepseek`。

- **Q: 为什么我的AI配音效果不好？**
- A: AI 推荐配音是通过大模型来决定不同的段落的配音参数，大模型的能力直接影响配音结果，你可以尝试更换不同的大模型，或者是用 Edge-TTS 选择固定的声音配音。

- **Q: 速度太慢？**
- A: AI 推荐配音需要把输入的文本分段、然后让 AI 分析、推荐每一分段的配音参数，最后再生成音频、拼接。速度会比直接用 Edge-TTS慢。你可以更换相应更快的大模型，或者尝试调节 Edge-TTS 的并发参数：EDGE_API_LIMIT为更大的值(10 以下)，注意并发太高可能会有限制。

## Tips

- 当前主要通过 Edge-TTS API 提供免费语音合成。  

- 未来计划支持官方 API、Google TTS、声音克隆等功能。


# 开发说明 2025-11-13
## EasyVoice这个工程运行的命令是pnpm build pnpm start这两个命令，这是按照生产版本需要运行的命令导致后续【frac库导入问题是通过升级项目】
## 这样的问题以及解决方式。
## 此工程在本地开发运行命令：pnpm dev
## 需要发布到服务器（linux）时才需要运行pnpm build 和pnpm start命令（这一步还有待验证）。
## 目前存在的问题：1，相同的请求缓存判定有问题；2，unity中边下载边播放的时候一卡一卡的。
## 2025-11-27;node.js的版本需要v20+,目前安装了v20.19.6直接就解决了问题：
root@iZ2zej9pzs8ovyjtkk5fvdZ:~/AIStudy/EasyVoice2# pnpm start

> easy-voice@0.0.15 start /root/AIStudy/EasyVoice2
> cross-env MODE=production pnpm --filter @easy-voice/backend start


> @easy-voice/backend@0.0.15 start /root/AIStudy/EasyVoice2/packages/backend
> node dist/server.js

info: init AudioCacheService with {"storageOptions":{"cacheDir":"/root/AIStudy/EasyVoice2/packages/backend/audio/.cache"},"storageType":"file","timestamp":"2025-11-26T09:48:27.479Z","ttl":31536000000}
Server running on port 3000
info: validateEdge {"format":"mp3","pitch":"+0Hz","rate":"+0%","text":"大战扶风郡将于5分钟后开始，请各位侠士前往洛阳步凡处报名参与。","timestamp":"2025-11-26T09:49:41.303Z","useLLM":false,"voice":"zh-CN-XiaoxiaoNeural","volume":"+0%"}
info: Generated stream task ID: taska89d150640d7482b03ee9173a4b91c88 {"timestamp":"2025-11-26T09:49:41.306Z"}
node:internal/process/promises:288
            triggerUncaughtException(err, true /* fromPromise */);
            ^

Error [ERR_REQUIRE_ESM]: require() of ES Module /root/AIStudy/EasyVoice2/node_modules/.pnpm/franc@6.2.0/node_modules/franc/index.js from /root/AIStudy/EasyVoice2/packages/backend/dist/utils/index.js not supported.
Instead change the require of /root/AIStudy/EasyVoice2/node_modules/.pnpm/franc@6.2.0/node_modules/franc/index.js in /root/AIStudy/EasyVoice2/packages/backend/dist/utils/index.js to a dynamic import() which is available in all CommonJS modules.
    at /root/AIStudy/EasyVoice2/packages/backend/dist/utils/index.js:58:71
    at async getLangConfig (/root/AIStudy/EasyVoice2/packages/backend/dist/utils/index.js:58:23)
    at async generateTTSStream (/root/AIStudy/EasyVoice2/packages/backend/dist/services/tts.stream.service.js:78:33) {
  code: 'ERR_REQUIRE_ESM'
}

Node.js v18.20.8
/root/AIStudy/EasyVoice2/packages/backend:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @easy-voice/backend@0.0.15 start: `node dist/server.js`
Exit status 1
 ELIFECYCLE  Command failed with exit code 1.
