// ポップアップが読み込まれたときの処理
document.addEventListener('DOMContentLoaded', () => {
  // 保存ボタンのクリックイベントを設定
  document.getElementById('saveButton').addEventListener('click', saveApiKey);
  
  // 保存されているAPIキーを取得して表示
  loadApiKey();
  
  // 要約履歴を表示
  loadSummaryHistory();
});

// APIキーを保存する関数
function saveApiKey() {
  const apiKey = document.getElementById('apiKey').value.trim();
  const ytApiKey = document.getElementById('ytApiKey').value.trim();
  const statusElement = document.getElementById('status');
  
  if (!apiKey || !ytApiKey) {
    statusElement.textContent = 'APIキーを入力してください';
    statusElement.className = 'status error';
    return;
  }
  
  // APIキーをChromeのストレージに保存
  chrome.storage.sync.set({ geminiApiKey: apiKey, youtubeApiKey: ytApiKey }, () => {
    if (chrome.runtime.lastError) {
      statusElement.textContent = 'エラー: ' + chrome.runtime.lastError.message;
      statusElement.className = 'status error';
    } else {
      statusElement.textContent = 'APIキーが保存されました';
      statusElement.className = 'status success';
      
      // 3秒後にステータスメッセージをクリア
      setTimeout(() => {
        statusElement.textContent = '';
      }, 3000);
    }
  });
}

// 保存されているAPIキーを取得して表示する関数
function loadApiKey() {
  chrome.storage.sync.get('geminiApiKey', 'youtubeApiKey', (data) => {
    if (data.geminiApiKey) {
      document.getElementById('apiKey').value = data.geminiApiKey;
    }
    if (data.youtubeApiKey) {
      document.getElementById('ytApiKey').value = data.youtubeApiKey;
    }
  });
}

// 要約履歴を読み込んで表示する関数
function loadSummaryHistory() {
  chrome.storage.local.get('summaryHistory', (data) => {
    const historyContainer = document.getElementById('historyItems');
    historyContainer.innerHTML = '';
    
    if (!data.summaryHistory || data.summaryHistory.length === 0) {
      historyContainer.innerHTML = '<div style="padding: 10px; color: #666;">履歴はありません</div>';
      return;
    }
    
    // 最新の5件を表示
    const recentHistory = data.summaryHistory.slice(0, 5);
    
    recentHistory.forEach(item => {
      const historyItem = document.createElement('div');
      historyItem.className = 'history-item';
      historyItem.dataset.videoId = item.videoId;
      
      const title = document.createElement('div');
      title.className = 'history-title';
      title.textContent = item.title;
      
      const date = document.createElement('div');
      date.className = 'history-date';
      date.textContent = new Date(item.timestamp).toLocaleString();
      
      historyItem.appendChild(title);
      historyItem.appendChild(date);
      
      // クリックイベントを追加
      historyItem.addEventListener('click', () => {
        openSummary(item.videoId);
      });
      
      historyContainer.appendChild(historyItem);
    });
  });
}

// 要約を開く関数
function openSummary(videoId) {
  chrome.storage.local.get('summaryHistory', (data) => {
    if (!data.summaryHistory) return;
    
    const summaryItem = data.summaryHistory.find(item => item.videoId === videoId);
    if (summaryItem) {
      // 現在の要約として設定
      chrome.storage.local.set({ currentSummary: summaryItem });
      
      // 要約ウィンドウを開く
      chrome.windows.create({
        url: chrome.runtime.getURL("summary.html"),
        type: "popup",
        width: 600,
        height: 600
      });
    }
  });
}
