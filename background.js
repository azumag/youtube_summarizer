// コンテキストメニューの作成
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "summarizeYouTube",
    title: "この動画をGemini AIで要約",
    contexts: ["link"],
    targetUrlPatterns: ["*://www.youtube.com/watch?v=*", "*://youtu.be/*"]
  });
});

// コンテキストメニューがクリックされたときの処理
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "summarizeYouTube") {
    const youtubeUrl = info.linkUrl;
    
    // YouTubeのURLからビデオIDを抽出
    const videoId = extractVideoId(youtubeUrl);
    if (!videoId) {
      console.error("ビデオIDを抽出できませんでした");
      return;
    }
    
    // ビデオ情報を取得して要約
    fetchVideoInfoAndSummarize(videoId);
  }
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
  const title = document.querySelector('h1.title')?.textContent || document.title;
  const description = document.querySelector('meta[name="description"]')?.content || '';
  const channelName = document.querySelector('div#owner-name a')?.textContent || '';
  
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
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`;
    
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
