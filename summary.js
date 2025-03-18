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
    // 前処理：マークダウン見出しやその他の特殊フォーマットを正規化
    let normalizedText = summaryText.replace(/^#+\s+/gm, ''); // マークダウン見出しを削除
    
    // セクションを分離するための正規則を定義
    const topicRegexes = [
      /(?:^|\n)(?:主なトピック|メイントピック|トピック|概要|動画の概要|1\.\s*(?:主な)?トピック)(?:\s*[:：]|\n)/i,
      /(?:^|\n)(?:I\.|1\.|1）|【概要】)/i
    ];
    
    const pointsRegexes = [
      /(?:^|\n)(?:重要(?:な|の)ポイント|主要(?:な|の)ポイント|ポイント|要点|重要点|2\.\s*(?:重要(?:な|の)?)?ポイント)(?:\s*[:：]|\n)/i,
      /(?:^|\n)(?:II\.|2\.|2）|【ポイント】)/i
    ];
    
    const conclusionRegexes = [
      /(?:^|\n)(?:結論|まとめ|総括|最後に|3\.\s*(?:結論|まとめ))(?:\s*[:：]|\n)/i,
      /(?:^|\n)(?:III\.|3\.|3）|【結論】|【まとめ】)/i
    ];
    
    // テキストからセクションを抽出する関数
    const extractSection = (text, startRegexes, endRegexes) => {
      // startRegexesのいずれかにマッチする位置を見つける
      let startMatch = null;
      let startIdx = -1;
      
      for (const regex of startRegexes) {
        const match = text.match(regex);
        if (match && (startIdx === -1 || match.index < startIdx)) {
          startMatch = match;
          startIdx = match.index;
        }
      }
      
      if (startIdx === -1) return null;
      
      // スタートのマッチの後ろから始める
      const contentStartIdx = startIdx + startMatch[0].length;
      
      // 次のセクションが始まる位置を見つける
      let endIdx = text.length;
      
      for (const regex of endRegexes) {
        const match = text.substring(contentStartIdx).match(regex);
        if (match && contentStartIdx + match.index < endIdx) {
          endIdx = contentStartIdx + match.index;
        }
      }
      
      // セクションのコンテンツを返す
      return text.substring(contentStartIdx, endIdx).trim();
    };
    
    // セクションを抽出
    let mainTopic = extractSection(normalizedText, topicRegexes, [...pointsRegexes, ...conclusionRegexes]) || '';
    let pointsSection = extractSection(normalizedText, pointsRegexes, conclusionRegexes) || '';
    let conclusion = extractSection(normalizedText, conclusionRegexes, []) || '';
    
    // ポイントを箇条書きに分解
    let keyPoints = [];
    
    // ポイントセクションがある場合は解析
    if (pointsSection) {
      // 箇条書きの行を検出 (-, •, *, 数字+ドットなど)
      const bulletPointsMatch = pointsSection.match(/(?:^|\n)[-•*][\s]*.+(?:\n|$)|(?:^|\n)\d+[\.\)][^\n]+(?:\n|$)/g);
      
      if (bulletPointsMatch) {
        // 箇条書きとして検出された行を処理
        keyPoints = bulletPointsMatch.map(point => {
          // 箇条書き記号と先頭の空白を削除
          return point.trim().replace(/^[-•*\d\.\)]\s*/, '');
        });
      } else {
        // 箇条書きが見つからない場合は段落ごとに分割
        keyPoints = pointsSection.split(/\n\s*\n/).filter(p => p.trim());
        
        // 各段落が長すぎる場合は、さらに文単位で分割することを検討
        if (keyPoints.length <= 1 && pointsSection.length > 100) {
          const sentences = pointsSection.match(/[^.!?。？！]+[.!?。？！]+/g) || [];
          if (sentences.length > 1) {
            keyPoints = sentences.map(s => s.trim());
          }
        }
      }
    }
    
    // 解析結果が不十分な場合は、テキスト全体を構造化してみる
    if ((!mainTopic && !keyPoints.length && !conclusion) || 
        (keyPoints.length === 0 && mainTopic.length + conclusion.length < normalizedText.length * 0.3)) {
      
      // テキストを段落に分割
      const paragraphs = normalizedText.split(/\n\s*\n/).filter(p => p.trim());
      
      if (paragraphs.length >= 3) {
        // 最低3つの段落がある場合、最初を主なトピック、真ん中をポイント、最後を結論とする
        mainTopic = mainTopic || paragraphs[0];
        
        // 中間の段落をポイントとして使用
        if (keyPoints.length === 0) {
          const middleParagraphs = paragraphs.slice(1, -1);
          
          for (const paragraph of middleParagraphs) {
            // 箇条書きの行を検出して分割
            const bulletPoints = paragraph.split(/\n/).filter(line => line.trim());
            keyPoints.push(...bulletPoints.map(line => line.replace(/^[-•*\d\.\)]\s*/, '')));
          }
        }
        
        conclusion = conclusion || paragraphs[paragraphs.length - 1];
      } else if (paragraphs.length === 2) {
        // 2つの段落しかない場合
        mainTopic = mainTopic || paragraphs[0];
        conclusion = conclusion || paragraphs[1];
      } else if (paragraphs.length === 1) {
        // テキスト全体が1つの段落の場合
        mainTopic = normalizedText;
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
