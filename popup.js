// ポップアップが読み込まれたときの処理
document.addEventListener('DOMContentLoaded', () => {
  // 保存ボタンのクリックイベントを設定
  document.getElementById('saveButton').addEventListener('click', saveApiKey);
  
  // 認証ボタンのクリックイベントを設定
  document.getElementById('authButton').addEventListener('click', authenticateWithGoogle);
  
  // 保存されているAPIキーを取得して表示
  loadApiKey();
  
  // 認証状態を確認して表示
  checkAuthStatus();
  
  // 要約履歴を表示
  loadSummaryHistory();
});

// APIキーを保存する関数
function saveApiKey() {
  const apiKey = document.getElementById('apiKey').value.trim();
  
  const statusElement = document.getElementById('status');
  
  if (!apiKey) {
    statusElement.textContent = 'APIキーを入力してください';
    statusElement.className = 'status error';
    return;
  }
  
  // APIキーをChromeのストレージに保存
  chrome.storage.sync.set({geminiApiKey: apiKey}, () => {
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
  chrome.storage.sync.get('geminiApiKey', (data) => {
    if (data.geminiApiKey) {
      document.getElementById('apiKey').value = data.geminiApiKey;
    }
  });
}

// Googleで認証する関数
function authenticateWithGoogle() {
  // ストレージからクライアントIDを取得
  chrome.storage.local.get('oauthClientId', (data) => {
    if (!data.oauthClientId) {
      console.error('OAuth クライアントIDが見つかりません');
      updateAuthStatus(false, 'OAuth クライアントIDが設定されていません。config.jsonを確認してください。');
      return;
    }
    
    // クライアントIDを使用して認証
    chrome.identity.getAuthToken({ 
      interactive: true,
      client_id: data.oauthClientId
    }, (token) => {
      if (chrome.runtime.lastError) {
        console.error('認証エラー:', chrome.runtime.lastError);
        updateAuthStatus(false, chrome.runtime.lastError.message);
        return;
      }
      
      if (token) {
        // トークンをストレージに保存
        chrome.storage.sync.set({ youtubeAuthToken: token }, () => {
          updateAuthStatus(true);
          
          // トークンの有効性を確認するためにユーザー情報を取得
          fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
            headers: {
              'Authorization': 'Bearer ' + token
            }
          })
          .then(response => {
            if (!response.ok) {
              throw new Error('トークンが無効です');
            }
            return response.json();
          })
          .then(userInfo => {
            // ユーザー情報を表示（オプション）
            console.log('認証されたユーザー:', userInfo.email);
          })
          .catch(error => {
            console.error('ユーザー情報の取得に失敗しました:', error);
            // トークンが無効な場合は削除
            chrome.identity.removeCachedAuthToken({ token }, () => {
              chrome.storage.sync.remove('youtubeAuthToken');
              updateAuthStatus(false, 'トークンが無効です。再度認証してください。');
            });
          });
        });
      } else {
        updateAuthStatus(false, '認証に失敗しました。再度お試しください。');
      }
    });
  });
}

// 認証状態を確認する関数
function checkAuthStatus() {
  chrome.storage.sync.get('youtubeAuthToken', (data) => {
    if (data.youtubeAuthToken) {
      // トークンの有効性を確認
      fetch('https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=' + data.youtubeAuthToken)
        .then(response => response.json())
        .then(tokenInfo => {
          if (tokenInfo.error) {
            // トークンが無効な場合
            chrome.identity.removeCachedAuthToken({ token: data.youtubeAuthToken }, () => {
              chrome.storage.sync.remove('youtubeAuthToken');
              updateAuthStatus(false, 'トークンの有効期限が切れています。再度認証してください。');
            });
          } else {
            // トークンが有効な場合
            updateAuthStatus(true);
          }
        })
        .catch(error => {
          console.error('トークン検証エラー:', error);
          updateAuthStatus(false, 'トークンの検証に失敗しました。再度認証してください。');
        });
    } else {
      // トークンがない場合
      updateAuthStatus(false);
    }
  });
}

// 認証状態を更新する関数
function updateAuthStatus(isAuthenticated, errorMessage = null) {
  const authStatusElement = document.getElementById('authStatus');
  const authButton = document.getElementById('authButton');
  
  if (isAuthenticated) {
    authStatusElement.textContent = 'YouTube APIへのアクセスが認証されています。字幕情報を取得できます。';
    authStatusElement.className = 'auth-status auth-signed';
    authButton.textContent = '再認証';
  } else {
    if (errorMessage) {
      authStatusElement.textContent = `YouTube APIへのアクセスが認証されていません: ${errorMessage}`;
    } else {
      authStatusElement.textContent = 'YouTube APIへのアクセスが認証されていません。字幕情報を取得するには認証が必要です。';
    }
    authStatusElement.className = 'auth-status auth-not-signed';
    authButton.textContent = 'Googleアカウントで認証';
  }
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
