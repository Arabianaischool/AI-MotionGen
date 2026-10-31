// DOM Elements
const codeEditor = document.getElementById('codeEditor');
const lineNumbers = document.getElementById('lineNumbers');
const filenameInput = document.getElementById('filename');
const generateBtn = document.getElementById('generateBtn');
const clearBtn = document.getElementById('clearBtn');
const loadFileBtn = document.getElementById('loadFileBtn');
const fileInput = document.getElementById('fileInput');
const templateBtn = document.getElementById('templateBtn');
const helpBtn = document.getElementById('helpBtn');

// Progress elements
const progressSection = document.getElementById('progressSection');
const progressText = document.getElementById('progressText');
const progressPercentage = document.getElementById('progressPercentage');
const progressFill = document.getElementById('progressFill');
const progressLog = document.getElementById('progressLog');

// Result elements
const resultSection = document.getElementById('resultSection');
const successCard = document.getElementById('successCard');
const errorCard = document.getElementById('errorCard');
const outputPath = document.getElementById('outputPath');
const errorMessage = document.getElementById('errorMessage');
const openFolderBtn = document.getElementById('openFolderBtn');

// Modal elements
const templatesModal = document.getElementById('templatesModal');
const helpModal = document.getElementById('helpModal');
const modalOverlay = document.getElementById('modalOverlay');
const helpModalOverlay = document.getElementById('helpModalOverlay');
const closeModal = document.getElementById('closeModal');
const closeHelpModal = document.getElementById('closeHelpModal');
const templatesGrid = document.getElementById('templatesGrid');

// Video Modal elements
const videoModal = document.getElementById('videoModal');
const videoModalOverlay = document.getElementById('videoModalOverlay');
const closeVideoModal = document.getElementById('closeVideoModal');
const modalVideo = document.getElementById('modalVideo');
const videoCards = document.querySelectorAll('.video-card');

// Server URL
const SERVER_URL = 'http://localhost:3847';

// Templates
const templates = [
  {
    name: 'عداد بسيط',
    description: 'عرض رقم الإطار الحالي',
    icon: '🔢',
    code: `import React from 'react';
import { useCurrentFrame, AbsoluteFill, interpolate } from 'remotion';

export const compositionConfig = {
  id: 'SimpleCounter',
  durationInSeconds: 5,
  fps: 30,
  width: 1080,
  height: 1920,
};

const SimpleCounter: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: 'clamp' });
  
  return (
    <AbsoluteFill style={{
      backgroundColor: '#1a1a2e',
      justifyContent: 'center',
      alignItems: 'center',
    }}>
      <div style={{
        fontSize: 200,
        fontWeight: 'bold',
        color: 'white',
        opacity,
        textShadow: '0 0 50px rgba(168, 85, 247, 0.5)',
      }}>
        {frame}
      </div>
    </AbsoluteFill>
  );
};

export default SimpleCounter;`
  },
  {
    name: 'نص متحرك',
    description: 'نص يظهر مع تأثير حركي',
    icon: '✨',
    code: `import React from 'react';
import { useCurrentFrame, AbsoluteFill, interpolate, spring, useVideoConfig } from 'remotion';

export const compositionConfig = {
  id: 'AnimatedText',
  durationInSeconds: 4,
  fps: 30,
  width: 1080,
  height: 1920,
};

const AnimatedText: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  
  const scale = spring({
    frame,
    fps,
    config: { damping: 10, stiffness: 100 },
  });
  
  const opacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });
  
  return (
    <AbsoluteFill style={{
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      justifyContent: 'center',
      alignItems: 'center',
    }}>
      <h1 style={{
        fontSize: 80,
        fontWeight: 'bold',
        color: 'white',
        textAlign: 'center',
        transform: \`scale(\${scale})\`,
        opacity,
        fontFamily: 'Tajawal, Arial, sans-serif',
      }}>
        مرحبًا بالعالم! 🎬
      </h1>
    </AbsoluteFill>
  );
};

export default AnimatedText;`
  },
  {
    name: 'دائرة متحركة',
    description: 'دائرة تتحرك وتتغير ألوانها',
    icon: '⭕',
    code: `import React from 'react';
import { useCurrentFrame, AbsoluteFill, interpolate } from 'remotion';

export const compositionConfig = {
  id: 'AnimatedCircle',
  durationInSeconds: 6,
  fps: 30,
  width: 1080,
  height: 1920,
};

const AnimatedCircle: React.FC = () => {
  const frame = useCurrentFrame();
  
  const y = interpolate(frame, [0, 90, 180], [0, 400, 0]);
  const scale = interpolate(frame, [0, 45, 90, 135, 180], [1, 1.3, 1, 1.3, 1]);
  const hue = interpolate(frame, [0, 180], [0, 360]);
  
  return (
    <AbsoluteFill style={{
      backgroundColor: '#0f0f1a',
      justifyContent: 'center',
      alignItems: 'center',
    }}>
      <div style={{
        width: 200,
        height: 200,
        borderRadius: '50%',
        background: \`hsl(\${hue}, 70%, 60%)\`,
        transform: \`translateY(\${y}px) scale(\${scale})\`,
        boxShadow: \`0 0 60px hsl(\${hue}, 70%, 50%)\`,
      }} />
    </AbsoluteFill>
  );
};

export default AnimatedCircle;`
  },
  {
    name: 'شريط تقدم',
    description: 'شريط تقدم متحرك',
    icon: '📊',
    code: `import React from 'react';
import { useCurrentFrame, AbsoluteFill, interpolate, useVideoConfig } from 'remotion';

export const compositionConfig = {
  id: 'ProgressBar',
  durationInSeconds: 5,
  fps: 30,
  width: 1080,
  height: 1920,
};

const ProgressBar: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  
  const progress = interpolate(frame, [0, durationInFrames - 30], [0, 100], {
    extrapolateRight: 'clamp',
  });
  
  return (
    <AbsoluteFill style={{
      background: 'linear-gradient(180deg, #1a1a2e 0%, #16213e 100%)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 50,
    }}>
      <div style={{ width: '80%' }}>
        <div style={{
          fontSize: 60,
          color: 'white',
          textAlign: 'center',
          marginBottom: 40,
          fontFamily: 'Tajawal, Arial, sans-serif',
        }}>
          {Math.round(progress)}%
        </div>
        <div style={{
          height: 30,
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
          borderRadius: 15,
          overflow: 'hidden',
        }}>
          <div style={{
            width: \`\${progress}%\`,
            height: '100%',
            background: 'linear-gradient(90deg, #a855f7, #3b82f6)',
            borderRadius: 15,
          }} />
        </div>
      </div>
    </AbsoluteFill>
  );
};

export default ProgressBar;`
  }
];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  updateLineNumbers();
  renderTemplates();
  setupEventListeners();
});

// Update line numbers
function updateLineNumbers() {
  const lines = codeEditor.value.split('\n');
  const lineNumbersHtml = lines.map((_, i) => `<div>${i + 1}</div>`).join('');
  lineNumbers.innerHTML = lineNumbersHtml || '<div>1</div>';
}

// Render templates
function renderTemplates() {
  templatesGrid.innerHTML = templates.map((template, index) => `
        <div class="template-card" data-index="${index}">
            <div class="template-icon">${template.icon}</div>
            <h3>${template.name}</h3>
            <p>${template.description}</p>
        </div>
    `).join('');
}

// Setup event listeners
function setupEventListeners() {
  // Code editor
  codeEditor.addEventListener('input', updateLineNumbers);
  codeEditor.addEventListener('scroll', () => {
    lineNumbers.scrollTop = codeEditor.scrollTop;
  });

  // Buttons
  generateBtn.addEventListener('click', generateVideo);
  clearBtn.addEventListener('click', () => {
    codeEditor.value = '';
    updateLineNumbers();
  });
  loadFileBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleFileLoad);

  // Modals
  templateBtn.addEventListener('click', () => templatesModal.classList.add('active'));
  helpBtn.addEventListener('click', () => helpModal.classList.add('active'));
  modalOverlay.addEventListener('click', () => templatesModal.classList.remove('active'));
  helpModalOverlay.addEventListener('click', () => helpModal.classList.remove('active'));
  closeModal.addEventListener('click', () => templatesModal.classList.remove('active'));
  closeHelpModal.addEventListener('click', () => helpModal.classList.remove('active'));

  // Template selection
  templatesGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.template-card');
    if (card) {
      const index = parseInt(card.dataset.index);
      codeEditor.value = templates[index].code;
      filenameInput.value = templates[index].name.replace(/\s+/g, '');
      updateLineNumbers();
      templatesModal.classList.remove('active');
    }
  });

  // Open folder button
  openFolderBtn.addEventListener('click', openOutputFolder);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      templatesModal.classList.remove('active');
      helpModal.classList.remove('active');
      closeVideoModalFunc();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      generateVideo();
    }
  });

  // Video cards click handlers
  videoCards.forEach(card => {
    card.addEventListener('click', () => {
      const videoSrc = card.dataset.videoSrc;
      if (videoSrc) {
        openVideoModal(videoSrc);
      }
    });
  });

  // Video modal close handlers
  if (videoModalOverlay) {
    videoModalOverlay.addEventListener('click', closeVideoModalFunc);
  }
  if (closeVideoModal) {
    closeVideoModal.addEventListener('click', closeVideoModalFunc);
  }
}

// Handle file load
function handleFileLoad(e) {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (event) => {
      codeEditor.value = event.target.result;
      filenameInput.value = file.name.replace('.tsx', '');
      updateLineNumbers();
    };
    reader.readAsText(file);
  }
}

// Generate video
async function generateVideo() {
  const code = codeEditor.value.trim();
  const filename = filenameInput.value.trim() || 'MyVideo';

  if (!code) {
    showError('الرجاء إدخال كود TSX');
    return;
  }

  // Validate code has required exports
  if (!code.includes('compositionConfig')) {
    showError('الكود يجب أن يحتوي على تصدير compositionConfig');
    return;
  }

  // Reset UI
  resultSection.style.display = 'none';
  successCard.style.display = 'none';
  errorCard.style.display = 'none';
  progressSection.style.display = 'block';
  progressLog.innerHTML = '';
  updateProgress(0, 'جاري حفظ الملف...');
  generateBtn.disabled = true;

  try {
    // Save TSX file
    addLog('حفظ ملف TSX...');
    const saveResponse = await fetch(`${SERVER_URL}/save-tsx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, filename })
    });

    if (!saveResponse.ok) {
      throw new Error('فشل في حفظ الملف');
    }

    const saveResult = await saveResponse.json();
    addLog(`تم حفظ الملف: ${saveResult.filepath}`);
    updateProgress(10, 'جاري بدء عملية التوليد...');

    // Start render process
    const renderResponse = await fetch(`${SERVER_URL}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filepath: saveResult.filepath })
    });

    if (!renderResponse.ok) {
      throw new Error('فشل في بدء عملية التوليد');
    }

    const { taskId } = await renderResponse.json();
    addLog(`بدأت مهمة التوليد: ${taskId}`);

    // Poll for progress
    await pollProgress(taskId);

  } catch (error) {
    showError(error.message || 'حدث خطأ غير متوقع');
  } finally {
    generateBtn.disabled = false;
  }
}

// Poll for render progress
async function pollProgress(taskId) {
  const pollInterval = 1000;

  while (true) {
    try {
      const response = await fetch(`${SERVER_URL}/status/${taskId}`);
      const status = await response.json();

      if (status.log) {
        addLog(status.log);
      }

      updateProgress(status.progress, status.message);

      if (status.status === 'completed') {
        showSuccess(status.outputPath);
        return;
      }

      if (status.status === 'error') {
        showError(status.error, status.logs);
        return;
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    } catch (error) {
      showError('فقد الاتصال بالخادم');
      return;
    }
  }
}

// Update progress
function updateProgress(percent, message) {
  progressFill.style.width = `${percent}%`;
  progressPercentage.textContent = `${Math.round(percent)}%`;
  progressText.textContent = message;
}

// Add log entry
function addLog(message) {
  const entry = document.createElement('div');
  entry.textContent = `> ${message}`;
  progressLog.appendChild(entry);
  progressLog.scrollTop = progressLog.scrollHeight;
}

// Show success
function showSuccess(path) {
  progressSection.style.display = 'none';
  resultSection.style.display = 'block';
  successCard.style.display = 'flex';
  errorCard.style.display = 'none';
  outputPath.textContent = `المسار: ${path}`;
  openFolderBtn.dataset.path = path;
}

// Show error
function showError(message, details = []) {
  progressSection.style.display = 'none';
  resultSection.style.display = 'block';
  successCard.style.display = 'none';
  errorCard.style.display = 'flex';
  errorMessage.textContent = message;

  const detailsContainer = document.getElementById('errorDetails');
  if (details && details.length > 0) {
    detailsContainer.textContent = details.join('\n');
    detailsContainer.parentElement.parentElement.style.display = 'block'; // Show if details exist
  } else {
    detailsContainer.textContent = '';
    detailsContainer.parentElement.parentElement.style.display = 'none';
  }
}

// Open output folder
async function openOutputFolder() {
  const path = openFolderBtn.dataset.path;
  if (path) {
    try {
      await fetch(`${SERVER_URL}/open-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      });
    } catch (error) {
      console.error('Failed to open folder:', error);
    }
  }
}

// Open video modal
function openVideoModal(videoSrc) {
  if (videoModal && modalVideo) {
    modalVideo.src = videoSrc;
    videoModal.classList.add('active');
    modalVideo.play();
  }
}

// Close video modal
function closeVideoModalFunc() {
  if (videoModal && modalVideo) {
    videoModal.classList.remove('active');
    modalVideo.pause();
    modalVideo.src = '';
  }
}
