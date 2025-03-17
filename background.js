// コンテキストメニューの作成
chrome.runtime.onInstalled.addListener(() => {
  // リンク用のコンテキストメニュー
  chrome.contextMenus.create({
    id: "summarizeYouTubeLink",
    title: "この動画をGemini AIで要約",
    contexts: ["link"],
    targetUrlPatterns: ["*://www.youtube.com/watch?v=*", "*://youtu.be/*"]
  });
  
  // ページ用のコンテキストメニュー（現在視聴中の動画ページ）
  chrome.contextMenus.create({
    id: "summarizeYouTubePage",
    title: "この動画をGemini AIで要約",
    contexts: ["page"],
    documentUrlPatterns: ["*://www.youtube.com/watch?v=*"]
  });
});

// コンテキストメニューがクリックされたときの処理
chrome.contextMenus.onClicked.addListener((info, tab) => {
  let videoUrl;
  let videoId;
  
  if (info.menuItemId === "summarizeYouTubeLink") {
    // リンクからの要約
    videoUrl = info.linkUrl;
    videoId = extractVideoId(videoUrl);
  } else if (info.menuItemId === "summarizeYouTubePage") {
    // 現在のページからの要約
    videoUrl = tab.url;
    videoId = extractVideoId(videoUrl);
  }
  
  if (!videoId) {
    console.error("ビデオIDを抽出できませんでした");
    return;
  }
  
  // ビデオ情報を取得して要約
  fetchVideoInfoAndSummarize(videoId);
});

// YouTubeのURLからビデオIDを抽出する関数
function extractVideoId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

// ビデオ情報を取得して要約する関数
async function fetchVideoInfoAndSummarize(videoId) {
  try {
    // ストレージからAPIキーを取得
    const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
    
    if (!geminiApiKey) {
      // APIキーが設定されていない場合は設定画面を開く
      chrome.runtime.openOptionsPage();
      return;
    }
    
    // YouTube Data APIを使用してビデオ情報を取得（実際の実装ではAPIキーが必要）
    // ここでは簡略化のため、直接YouTubeページから情報を取得する方法を使用
    chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${videoId}`, active: false }, async (tab) => {
      // タブが完全に読み込まれるのを待つ
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // コンテンツスクリプトを実行してビデオ情報を取得
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: getVideoInfo
      }, async (results) => {
        if (chrome.runtime.lastError || !results || !results[0]) {
          console.error("ビデオ情報の取得に失敗しました", chrome.runtime.lastError);
          chrome.tabs.remove(tab.id);
          return;
        }
        
        const videoInfo = results[0].result;
        
        // Gemini AIで要約
        const summary = await summarizeWithGemini(videoInfo, geminiApiKey);
        
        // 要約結果を表示
        displaySummary(videoId, videoInfo.title, summary);
        
        // 使用済みのタブを閉じる
        chrome.tabs.remove(tab.id);
      });
    });
  } catch (error) {
    console.error("要約処理中にエラーが発生しました", error);
  }
}

// YouTubeページからビデオ情報を取得する関数（コンテンツスクリプトとして実行）
function getVideoInfo() {
  // タイトルの取得（複数のセレクタを試行）
  let title = '';
  const titleSelectors = [
    'h1.title.style-scope.ytd-video-primary-info-renderer',
    'h1.ytd-watch-metadata',
    'h1.title',
    '#title h1',
    '#container h1'
  ];
  
  for (const selector of titleSelectors) {
    const element = document.querySelector(selector);
    if (element && element.textContent.trim()) {
      title = element.textContent.trim();
      break;
    }
  }
  
  // タイトルが取得できなかった場合はdocument.titleを使用
  if (!title) {
    title = document.title.replace(' - YouTube', '');
  }
  
  // チャンネル名の取得（複数のセレクタを試行）
  let channelName = '';
  const channelSelectors = [
    'ytd-channel-name yt-formatted-string',
    '#owner-name a',
    '#channel-name',
    '#upload-info a',
    '#owner #text'
  ];
  
  for (const selector of channelSelectors) {
    const element = document.querySelector(selector);
    if (element && element.textContent.trim()) {
      channelName = element.textContent.trim();
      break;
    }
  }
  
  // 説明の取得（複数のセレクタを試行）
  let description = '';
  const descriptionSelectors = [
    'meta[name="description"]',
    '#description-inline-expander',
    '#description ytd-expander',
    '#description-text',
    '#description'
  ];
  
  for (const selector of descriptionSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      if (selector === 'meta[name="description"]') {
        description = element.content;
      } else {
        description = element.textContent.trim();
      }
      
      if (description) {
        break;
      }
    }
  }
  
  console.log('取得した動画情報:', { title, channelName, description });
  
  return {
    title,
    description,
    channelName,
    url: window.location.href
  };
}

// Gemini AIで要約する関数
async function summarizeWithGemini(videoInfo, apiKey) {
  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    
    const prompt = `
      以下のYouTube動画の内容を要約してください。
      タイトル: ${videoInfo.title}
      チャンネル: ${videoInfo.channelName}
      説明: ${videoInfo.description}
      
      要約は以下の形式で行ってください：
      1. 動画の主なトピック（50文字以内）
      2. 重要なポイント（箇条書きで3-5点）
      3. 結論（100文字以内）
    `;
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }]
      })
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
  } catch (error) {
    console.error("Gemini APIの呼び出しに失敗しました", error);
    return "要約の生成中にエラーが発生しました。APIキーが正しいか確認してください。";
  }
}

// 要約結果を表示する関数
function displaySummary(videoId, title, summary) {
  chrome.storage.local.set({ 
    currentSummary: { videoId, title, summary, timestamp: Date.now() } 
  });
  
  // ポップアップを開いて要約を表示
  chrome.windows.create({
    url: chrome.runtime.getURL("summary.html"),
    type: "popup",
    width: 600,
    height: 600
  });
}
