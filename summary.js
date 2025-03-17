// ページが読み込まれたときの処理
document.addEventListener('DOMContentLoaded', () => {
  // ストレージから現在の要約データを取得
  chrome.storage.local.get('currentSummary', (data) => {
    if (chrome.runtime.lastError) {
      showError('データの読み込み中にエラーが発生しました: ' + chrome.runtime.lastError.message);
      return;
    }
    
    if (!data.currentSummary) {
      showError('要約データが見つかりませんでした');
      return;
    }
    
    // 要約データを表示
    displaySummary(data.currentSummary);
    
    // 履歴に追加
    addToHistory(data.currentSummary);
  });
  
  // コピーボタンのイベントリスナーを設定
  document.getElementById('copy-button').addEventListener('click', copySummaryToClipboard);
});

// 要約データを表示する関数
function displaySummary(summaryData) {
  try {
    // ビデオIDを取得
    const videoId = summaryData.videoId;
    
    // タイトルを設定
    document.getElementById('video-title').textContent = summaryData.title;
    
    // リンクを設定
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    document.getElementById('video-link').href = videoUrl;
    
    // サムネイルを設定
    document.getElementById('video-thumbnail').style.backgroundImage = 
      `url(https://img.youtube.com/vi/${videoId}/mqdefault.jpg)`;
    
    // 生成日時を設定
    document.getElementById('generation-time').textContent = 
      new Date(summaryData.timestamp).toLocaleString();
    
    // 要約テキストを解析して表示
    parseSummaryText(summaryData.summary);
    
    // ローディング表示を非表示にして要約コンテンツを表示
    document.getElementById('loading').style.display = 'none';
    document.getElementById('summary-content').style.display = 'block';
  } catch (error) {
    showError('要約の表示中にエラーが発生しました: ' + error.message);
  }
}

// 要約テキストを解析して表示する関数
function parseSummaryText(summaryText) {
  try {
    // 要約テキストを行に分割
    const lines = summaryText.split('\n').filter(line => line.trim() !== '');
    
    let mainTopic = '';
    let keyPoints = [];
    let conclusion = '';
    
    // 現在の解析モード
    let currentMode = 'none';
    
    // 各行を解析
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // 主なトピックの検出
      if (trimmedLine.match(/^1\.\s+.*トピック/) || 
          trimmedLine.match(/^主なトピック/i)) {
        currentMode = 'topic';
        continue;
      }
      
      // 重要なポイントの検出
      if (trimmedLine.match(/^2\.\s+.*ポイント/) || 
          trimmedLine.match(/^重要なポイント/i)) {
        currentMode = 'points';
        continue;
      }
      
      // 結論の検出
      if (trimmedLine.match(/^3\.\s+.*結論/) || 
          trimmedLine.match(/^結論/i)) {
        currentMode = 'conclusion';
        continue;
      }
      
      // 現在のモードに応じてテキストを追加
      if (currentMode === 'topic') {
        if (!mainTopic) {
          mainTopic = trimmedLine.replace(/^[-•*]\s+/, '');
        }
      } else if (currentMode === 'points') {
        // 箇条書きの検出
        if (trimmedLine.match(/^[-•*]\s+/) || trimmedLine.match(/^\d+\.\s+/)) {
          keyPoints.push(trimmedLine.replace(/^[-•*\d\.]\s+/, ''));
        } else if (keyPoints.length > 0) {
          // 前の箇条書きの続きの場合
          keyPoints[keyPoints.length - 1] += ' ' + trimmedLine;
        } else {
          // 箇条書きでない場合は新しいポイントとして追加
          keyPoints.push(trimmedLine);
        }
      } else if (currentMode === 'conclusion') {
        if (conclusion) {
          conclusion += ' ' + trimmedLine;
        } else {
          conclusion = trimmedLine;
        }
      }
    }
    
    // 解析結果が不十分な場合は、単純に分割
    if (!mainTopic && !keyPoints.length && !conclusion) {
      const parts = summaryText.split('\n\n');
      if (parts.length >= 3) {
        mainTopic = parts[0];
        
        // 中間部分を箇条書きとして解析
        const middlePart = parts[1];
        keyPoints = middlePart.split('\n')
          .filter(line => line.trim() !== '')
          .map(line => line.replace(/^[-•*\d\.]\s+/, ''));
        
        conclusion = parts[2];
      } else {
        // 十分な分割ができない場合は、全体を表示
        mainTopic = summaryText;
      }
    }
    
    // 結果を表示
    document.getElementById('main-topic').textContent = mainTopic || '情報がありません';
    
    const keyPointsList = document.getElementById('key-points');
    keyPointsList.innerHTML = '';
    
    if (keyPoints.length > 0) {
      keyPoints.forEach(point => {
        const li = document.createElement('li');
        li.textContent = point;
        keyPointsList.appendChild(li);
      });
    } else {
      const li = document.createElement('li');
      li.textContent = '情報がありません';
      keyPointsList.appendChild(li);
    }
    
    document.getElementById('conclusion').textContent = conclusion || '情報がありません';
  } catch (error) {
    console.error('要約テキストの解析中にエラーが発生しました', error);
    
    // エラーが発生した場合は、生のテキストを表示
    document.getElementById('main-topic').textContent = '解析エラー';
    
    const keyPointsList = document.getElementById('key-points');
    keyPointsList.innerHTML = '';
    const li = document.createElement('li');
    li.textContent = '要約テキストの解析中にエラーが発生しました';
    keyPointsList.appendChild(li);
    
    document.getElementById('conclusion').textContent = summaryText;
  }
}

// 要約を履歴に追加する関数
function addToHistory(summaryData) {
  chrome.storage.local.get('summaryHistory', (data) => {
    let history = data.summaryHistory || [];
    
    // 同じビデオIDの要約が既に存在するか確認
    const existingIndex = history.findIndex(item => item.videoId === summaryData.videoId);
    
    if (existingIndex !== -1) {
      // 既存のエントリを削除
      history.splice(existingIndex, 1);
    }
    
    // 新しい要約を先頭に追加
    history.unshift(summaryData);
    
    // 履歴は最大20件まで保存
    if (history.length > 20) {
      history = history.slice(0, 20);
    }
    
    // 更新した履歴を保存
    chrome.storage.local.set({ summaryHistory: history });
  });
}

// 要約をクリップボードにコピーする関数
function copySummaryToClipboard() {
  try {
    const title = document.getElementById('video-title').textContent;
    const mainTopic = document.getElementById('main-topic').textContent;
    const conclusion = document.getElementById('conclusion').textContent;
    
    // キーポイントを取得
    const keyPointsElements = document.querySelectorAll('#key-points li');
    const keyPoints = Array.from(keyPointsElements).map(li => `• ${li.textContent}`).join('\n');
    
    // コピーするテキストを作成
    const copyText = `【${title}】の要約\n\n` +
                     `■ 主なトピック\n${mainTopic}\n\n` +
                     `■ 重要なポイント\n${keyPoints}\n\n` +
                     `■ 結論\n${conclusion}\n\n` +
                     `Powered by YouTube Summarizer (Gemini AI)`;
    
    // クリップボードにコピー
    navigator.clipboard.writeText(copyText).then(() => {
      const copyButton = document.getElementById('copy-button');
      const originalText = copyButton.textContent;
      
      // ボタンのテキストを一時的に変更
      copyButton.textContent = 'コピーしました！';
      
      // 3秒後に元のテキストに戻す
      setTimeout(() => {
        copyButton.innerHTML = `<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxyZWN0IHg9IjkiIHk9IjkiIHdpZHRoPSIxMyIgaGVpZ2h0PSIxMyIgcng9IjIiIHJ5PSIyIj48L3JlY3Q+PHBhdGggZD0iTTUgMTVINGEyIDIgMCAwIDEtMi0yVjRhMiAyIDAgMCAxIDItMmg5YTIgMiAwIDAgMSAyIDJ2MSI+PC9wYXRoPjwvc3ZnPg==" alt="コピー">要約をコピー`;
      }, 3000);
    }).catch(err => {
      console.error('クリップボードへのコピーに失敗しました', err);
      alert('クリップボードへのコピーに失敗しました: ' + err.message);
    });
  } catch (error) {
    console.error('コピー処理中にエラーが発生しました', error);
    alert('コピー処理中にエラーが発生しました: ' + error.message);
  }
}

// エラーを表示する関数
function showError(message) {
  document.getElementById('loading').style.display = 'none';
  
  const errorElement = document.getElementById('error');
  errorElement.textContent = message;
  errorElement.style.display = 'block';
}
