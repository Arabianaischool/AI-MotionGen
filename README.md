# 🎬 AI Motion Graphics Generator

A powerful tool to convert TSX/React code into stunning motion graphics videos using Remotion. Created for content creators and developers who want to generate professional animated videos programmatically.

<img width="1469" height="908" alt="image" src="https://github.com/user-attachments/assets/0516968f-60e3-4065-b747-cb7fd257818a" />


## 🌟 Features

- ✨ **Easy-to-use Web Interface** - Simple UI to paste your TSX code and generate videos
- 🎨 **Template Library** - Pre-built templates to get started quickly
- 🎥 **High-Quality Output** - Generate MP4 videos with customizable resolution and FPS
- ⚡ **Real-time Progress** - Watch the rendering progress in real-time
- 📁 **Project Management** - Automatically saves your projects

## 📺 Tutorial & Resources

- **YouTube Channel**: [Arabian AI School (مدرسة الذكاء الاصطناعي)](https://www.youtube.com/@ArabianAiSchool?sub_confirmation=1)
- **Video Tutorial**: https://www.youtube.com/watch?v=CfVgE0Dawa8
- [PopcornAI](https://popcornai.art/) - AI video and image generator for branded short clips, launch visuals, and campaign-ready creative assets.
- **download** : https://drive.google.com/file/d/1E4MSVhywhYq58fYVv9Qr_28PX0LJa-Qf/view?pli=1
## 🚀 Quick Start

### Prerequisites

Before you begin, make sure you have the following installed:

1. **Node.js** (version 18 or higher)
   - Download from: https://nodejs.org/
   - Verify installation: `node --version`

2. **npm** (comes with Node.js)
   - Verify installation: `npm --version`

### Installation Steps

1. **Clone or Download the Repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/AI-MotionGen.git
   cd AI-MotionGen
   ```

2. **Install Dependencies for the UI Server**
   ```bash
   cd node
   npm install
   cd ..
   ```

3. **Install Dependencies for the Renderer**
   ```bash
   cd renderer
   npm install
   cd ..
   ```

### Running the Tool

**Option 1: Using the Batch File (Windows)**
```bash
# Double-click start-ui.bat
# OR run from command line:
.\start-ui.bat
```

**Option 2: Manual Start**
```bash
cd node
node ../ui/server.js
```

Then open your browser and go to: **http://localhost:3847**

## 📖 How to Use

1. **Open the Web Interface** - Navigate to http://localhost:3847 in your browser

2. **Write or Paste TSX Code** - Enter your React/Remotion code in the editor
   
3. **Set Filename** - Give your project a name

4. **Click "Generate Video"** - The tool will render your video

5. **Download** - Once complete, the video will be saved in the `renders` folder

## 📝 Code Requirements

Your TSX code must include:

```tsx
// Required: Export composition config
export const compositionConfig = {
  id: 'MyVideo',
  durationInSeconds: 5,
  fps: 30,
  width: 1080,
  height: 1920,
};

// Required: Default export your component
export default MyComponent;
```

### Example Code

```tsx
import React from 'react';
import { useCurrentFrame, AbsoluteFill, interpolate } from 'remotion';

export const compositionConfig = {
  id: 'HelloWorld',
  durationInSeconds: 5,
  fps: 30,
  width: 1080,
  height: 1920,
};

const HelloWorld: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 30], [0, 1]);
  
  return (
    <AbsoluteFill style={{
      backgroundColor: '#1a1a2e',
      justifyContent: 'center',
      alignItems: 'center',
    }}>
      <h1 style={{
        fontSize: 80,
        color: 'white',
        opacity,
      }}>
        Hello World! 🎬
      </h1>
    </AbsoluteFill>
  );
};

export default HelloWorld;
```

## 📁 Project Structure

```
AI-MotionGen/
├── ui/                 # Web interface files
│   ├── index.html      # Main HTML file
│   ├── styles.css      # Styling
│   ├── app.js          # Frontend JavaScript
│   └── server.js       # Node.js server
├── renderer/           # Remotion renderer
├── node/               # Node.js dependencies
├── projects/           # Your saved TSX projects
├── renders/            # Output video files
├── example/            # Example videos and thumbnails
├── start-ui.bat        # Windows startup script
└── render.bat          # Render script
```

## 🎨 Templates

The tool includes several built-in templates:

- **Simple Counter** - Display animated frame numbers
- **Animated Text** - Text with spring animations
- **Animated Circle** - Moving and color-changing circle
- **Progress Bar** - Animated progress indicator

## ⚠️ Troubleshooting

### Common Issues

1. **"Node.js not found"**
   - Install Node.js from https://nodejs.org/
   - Restart your terminal after installation

2. **"Port 3847 already in use"**
   - Close any other applications using this port
   - Or change the port in `ui/server.js`

3. **"Render failed"**
   - Check your TSX code for syntax errors
   - Make sure `compositionConfig` is properly exported
   - Check the error details in the UI

4. **"npm install fails"**
   - Try running as administrator
   - Delete `node_modules` folder and try again
   - Check your internet connection

## 🤝 Contributing

Contributions are welcome! Feel free to:

- Report bugs
- Suggest new features
- Submit pull requests

## 📄 License

This project is open source and available under the MIT License.

## 🙏 Credits

- **Developer**: [Baraa Mohammed](https://www.youtube.com/@ArabianAiSchool)
- **Channel**: [Arabian AI School](https://www.youtube.com/@ArabianAiSchool?sub_confirmation=1)
- **Powered by**: [Remotion](https://remotion.dev/)

---

⭐ If you find this tool useful, please give it a star on GitHub and subscribe to the channel!

🔔 Subscribe: https://www.youtube.com/@ArabianAiSchool?sub_confirmation=1





