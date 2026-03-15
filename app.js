/**
 * 逐句提示词阅读器 - 主逻辑
 *
 * 功能：
 *  - 多行提示词输入/粘贴，每行一句，本地存储持久化
 *  - 逐句显示，手动点击「我读完了」切换下一句
 *  - 自动模式：Web Speech API 语音识别，说话停顿后自动切换
 *  - 支持重置，回到第一句
 *  - 浏览器不支持语音 API 时自动降级为纯手动模式
 *  - 麦克风权限被拒绝时提示用户并回退到手动模式
 */

/* ======================================================
   常量 & 全局状态
   ====================================================== */
const STORAGE_KEY = 'lbl_prompt_text';   // localStorage 键名

const state = {
  lines: [],          // 分割后的句子数组
  currentIndex: 0,    // 当前句子索引
  autoMode: false,    // 自动模式是否开启
  isListening: false, // 语音识别是否正在运行
  recognition: null,  // SpeechRecognition 实例
  hasSpeechAPI: false // 浏览器是否支持语音 API
};

/* ======================================================
   DOM 引用
   ====================================================== */
const dom = {
  editPanel:        document.getElementById('edit-panel'),
  promptInput:      document.getElementById('prompt-input'),
  saveBtn:          document.getElementById('save-btn'),
  cancelEditBtn:    document.getElementById('cancel-edit-btn'),
  editToggleBtn:    document.getElementById('edit-toggle-btn'),

  readPanel:        document.getElementById('read-panel'),
  currentLineText:  document.getElementById('current-line-text'),
  emptyHint:        document.getElementById('empty-hint'),
  doneHint:         document.getElementById('done-hint'),
  currentLineCard:  document.getElementById('current-line-card'),
  speechStatus:     document.getElementById('speech-status'),

  progressFill:     document.getElementById('progress-fill'),
  progressText:     document.getElementById('progress-text'),

  nextBtn:          document.getElementById('next-btn'),
  resetBtn:         document.getElementById('reset-btn'),

  autoRow:          document.getElementById('auto-row'),
  autoToggle:       document.getElementById('auto-toggle'),

  notificationBar:  document.getElementById('notification-bar'),
  notifMsg:         document.getElementById('notif-msg'),
  notifClose:       document.getElementById('notif-close')
};

/* ======================================================
   初始化
   ====================================================== */
function init() {
  /* 检测语音 API 支持 */
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (SpeechRecognition) {
    state.hasSpeechAPI = true;
    setupSpeechRecognition(SpeechRecognition);
  } else {
    /* 浏览器不支持，隐藏自动模式行 */
    dom.autoRow.style.display = 'none';
  }

  /* 从 localStorage 还原上次输入的内容 */
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    dom.promptInput.value = saved;
    parseAndRender(saved);
  } else {
    renderCurrentLine(); // 显示空状态提示
  }

  /* 绑定事件 */
  dom.editToggleBtn.addEventListener('click', toggleEditPanel);
  dom.saveBtn.addEventListener('click', onSave);
  dom.cancelEditBtn.addEventListener('click', toggleEditPanel);
  dom.nextBtn.addEventListener('click', onNext);
  dom.resetBtn.addEventListener('click', onReset);
  dom.autoToggle.addEventListener('change', onAutoToggleChange);
  dom.notifClose.addEventListener('click', hideNotification);

  /* 注册 Service Worker（PWA 离线支持） */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* Service Worker 注册失败不影响主功能 */
    });
  }
}

/* ======================================================
   提示词解析与渲染
   ====================================================== */

/**
 * 解析文本，按行拆分，过滤空行
 */
function parseAndRender(text) {
  state.lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  state.currentIndex = 0;
  renderCurrentLine();
  renderProgress();
}

/**
 * 渲染当前句子到卡片
 */
function renderCurrentLine() {
  const { lines, currentIndex } = state;

  /* 隐藏所有状态层 */
  dom.emptyHint.style.display    = 'none';
  dom.doneHint.style.display     = 'none';
  dom.currentLineText.style.display = 'none';

  if (lines.length === 0) {
    /* 空状态 */
    dom.emptyHint.style.display = 'block';
    setNextBtnDisabled(true);
    return;
  }

  if (currentIndex >= lines.length) {
    /* 全部读完 */
    dom.doneHint.style.display = 'block';
    setNextBtnDisabled(true);
    /* 自动模式下停止监听 */
    if (state.autoMode) stopListening();
    return;
  }

  /* 正常显示当前句子 */
  dom.currentLineText.textContent = lines[currentIndex];
  dom.currentLineText.style.display = 'block';
  dom.currentLineText.classList.remove('fade-in');
  /* 触发重绘后再加动画，确保每次换句都有动效 */
  void dom.currentLineText.offsetWidth;
  dom.currentLineText.classList.add('fade-in');

  setNextBtnDisabled(false);
}

/**
 * 更新进度条
 */
function renderProgress() {
  const total   = state.lines.length;
  const current = Math.min(state.currentIndex + 1, total);

  if (total === 0) {
    dom.progressFill.style.width = '0%';
    dom.progressText.textContent = '0 / 0';
    return;
  }

  const pct = ((state.currentIndex) / total) * 100;
  dom.progressFill.style.width = pct + '%';
  dom.progressText.textContent = `${current} / ${total}`;
}

/* ======================================================
   编辑面板
   ====================================================== */
function toggleEditPanel() {
  const isVisible = dom.editPanel.classList.toggle('visible');
  dom.editToggleBtn.setAttribute('aria-expanded', isVisible ? 'true' : 'false');
  /* 打开时把当前存储内容填入 textarea */
  if (isVisible) {
    const saved = localStorage.getItem(STORAGE_KEY) || '';
    dom.promptInput.value = saved;
    dom.promptInput.focus();
  }
}

function onSave() {
  const text = dom.promptInput.value;
  localStorage.setItem(STORAGE_KEY, text);
  parseAndRender(text);
  toggleEditPanel(); // 关闭编辑面板
}

/* ======================================================
   手动切换
   ====================================================== */
function onNext() {
  if (state.currentIndex < state.lines.length) {
    state.currentIndex++;
    renderCurrentLine();
    renderProgress();
  }
}

function onReset() {
  state.currentIndex = 0;
  renderCurrentLine();
  renderProgress();
  /* 如果自动模式开启，重新开始监听 */
  if (state.autoMode && state.hasSpeechAPI) {
    stopListening();
    startListening();
  }
}

/* ======================================================
   按钮状态助手
   ====================================================== */
function setNextBtnDisabled(disabled) {
  dom.nextBtn.disabled = disabled;
}

/* ======================================================
   自动模式（Web Speech API）
   ====================================================== */

/**
 * 初始化 SpeechRecognition 实例
 */
function setupSpeechRecognition(SpeechRecognition) {
  const recog = new SpeechRecognition();
  recog.continuous      = true;   // 持续监听
  recog.interimResults  = false;  // 只要最终结果
  recog.maxAlternatives = 1;

  /* 检测到语音结果（说话停顿后触发） */
  recog.onresult = () => {
    if (state.autoMode) {
      onNext(); // 自动切换到下一句
    }
  };

  recog.onerror = (event) => {
    if (event.error === 'not-allowed' || event.error === 'permission-denied') {
      /* 麦克风权限被拒绝 */
      showNotification('⚠️ 麦克风权限被拒绝，已切回手动模式。请在浏览器设置中允许麦克风访问。', 'error');
      disableAutoMode();
    } else if (event.error === 'no-speech') {
      /* 一段时间没有检测到语音，重新开始监听 */
      if (state.autoMode) {
        restartListening();
      }
    }
    /* 其他错误静默处理，下面 onend 会重启 */
  };

  recog.onend = () => {
    state.isListening = false;
    updateSpeechUI();
    /* 自动模式下且未读完，自动重新开始监听 */
    if (state.autoMode && state.currentIndex < state.lines.length) {
      /* 短暂延迟后重启，避免立即循环 */
      setTimeout(startListening, 300);
    }
  };

  state.recognition = recog;
}

function onAutoToggleChange() {
  state.autoMode = dom.autoToggle.checked;

  if (state.autoMode) {
    /* 开启自动模式 */
    if (state.lines.length > 0 && state.currentIndex < state.lines.length) {
      requestMicAndStart();
    }
  } else {
    /* 关闭自动模式，停止监听 */
    stopListening();
  }
}

/**
 * 请求麦克风权限并开始监听
 */
function requestMicAndStart() {
  /* 先尝试请求麦克风权限（给出明确的错误信息） */
  navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then(() => {
      startListening();
    })
    .catch((err) => {
      if (err && (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError')) {
        showNotification('⚠️ 未检测到麦克风设备，已切回手动模式。', 'error');
      } else {
        /* NotAllowedError / PermissionDeniedError 及其他 */
        showNotification('⚠️ 麦克风权限被拒绝，已切回手动模式。请在浏览器设置中允许麦克风访问。', 'error');
      }
      disableAutoMode();
    });
}

function startListening() {
  if (!state.recognition || state.isListening) return;
  try {
    state.recognition.start();
    state.isListening = true;
    updateSpeechUI();
  } catch {
    /* 忽略 InvalidStateError 等 */
  }
}

function stopListening() {
  if (!state.recognition) return;
  try {
    state.recognition.stop();
  } catch {
    /* 忽略 */
  }
  state.isListening = false;
  updateSpeechUI();
}

function restartListening() {
  stopListening();
  setTimeout(startListening, 400);
}

/**
 * 强制关闭自动模式（权限被拒时调用）
 */
function disableAutoMode() {
  state.autoMode = false;
  dom.autoToggle.checked = false;
  stopListening();
}

/**
 * 更新卡片发光与语音状态指示器
 */
function updateSpeechUI() {
  if (state.isListening) {
    dom.currentLineCard.classList.add('listening');
    dom.speechStatus.style.display = 'flex';
  } else {
    dom.currentLineCard.classList.remove('listening');
    dom.speechStatus.style.display = 'none';
  }
}

/* ======================================================
   通知/提示条
   ====================================================== */
let notifTimer = null;

function showNotification(message, type = 'error') {
  dom.notifMsg.textContent = message;
  dom.notificationBar.className = 'visible';
  if (type === 'info') dom.notificationBar.classList.add('info');
  dom.notificationBar.style.display = 'flex'; // 兼容旧写法

  /* 5 秒后自动消失 */
  clearTimeout(notifTimer);
  notifTimer = setTimeout(hideNotification, 5000);
}

function hideNotification() {
  dom.notificationBar.classList.remove('visible');
  dom.notificationBar.style.display = 'none';
}

/* ======================================================
   启动
   ====================================================== */
document.addEventListener('DOMContentLoaded', init);
