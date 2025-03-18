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

async function getYouTubeCaptions(videoId, apiKey) {
  const apiUrl = `https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${videoId}&key=${apiKey}`;

  try {
    const response = await fetch(apiUrl);
    const data = await response.json();

    if (data.items && data.items.length > 0) {
      const captionId = data.items[0].id;
      const captionUrl = `https://www.googleapis.com/youtube/v3/captions/${captionId}?part=snippet&key=${apiKey}`;

      const captionResponse = await fetch(captionUrl);
      const captionData = await captionResponse.text();

      return captionData;
    } else {
      return "字幕が見つかりませんでした。";
    }
  } catch (error) {
    console.error("字幕の取得中にエラーが発生しました:", error);
    return "エラーが発生しました。";
  }
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

    // ストレージからAPIキーを取得
    const { youtubeApiKey } = await chrome.storage.sync.get('youtubeApiKey');
  
    if (!youtubeApiKey) {
      // APIキーが設定されていない場合は設定画面を開く
      chrome.runtime.openOptionsPage();
      return;
    }
    
    const captions = await getYouTubeCaptions(videoId, youtubeApiKey);
        
    // 字幕が取得できたかチェック
    if (!captions || captions.trim().length === 0) {
      // 字幕がない場合、その旨を表示
      displaySummary(videoId, "", "この動画には字幕情報がないため、要約を生成できません。\n\n字幕が利用可能な動画で再度お試しください。");
      return;
    }
        
    // Gemini AIで要約
    const summary = await summarizeWithGemini(captions, geminiApiKey);
        
    // 要約結果を表示
    // TODO: videoInfo
    displaySummary(videoId, "", summary);
  } catch (error) {
    console.error("要約処理の初期化中にエラーが発生しました", error);
    processingSummaryTab = null;
  }
}

// Gemini AIで要約する関数
async function summarizeWithGemini(captions, apiKey) {
  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    
    // captionUrlsが含まれている場合の処理（今回の実装では使用しない）
    if (captions.startsWith('CAPTION_URLS:')) {
      return "字幕データが取得できましたが、内容を抽出できませんでした。\n開発者向け情報: 字幕URLが存在します。";
    }
    
    // 字幕はあるが内容が取得できない場合
    if (captions.startsWith('CAPTION_AVAILABLE:')) {
      return "字幕は存在しますが、内容を取得できませんでした。\n別の動画で再度お試しください。";
    }
    
    // 字幕のみを使用した要約のためのプロンプト
    const prompt = `
あなたは正確な要約を生成する専門家です。以下のYouTube動画の字幕情報のみに基づいて要約してください。
タイトルや説明などの他の情報は無視し、字幕のみを参考にしてください。推測や憶測は厳禁です。

# 動画の文字起こし／字幕
${captions}

# 要約の構成
以下の構成で要約を作成してください：

## 主なトピック
動画の主題と目的を1-2段落で簡潔に説明してください。字幕から明確に判断できない場合は「動画のトピックは字幕情報のみからは明確に特定できません」と記載してください。

## 重要なポイント
動画内で明示的に言及されている主要なポイントを箇条書きでまとめてください。各ポイントは簡潔で明確であること。字幕から明確なポイントが抽出できない場合は「字幕情報からは重要なポイントを特定できません」と記載してください。

## 結論
動画の結論部分または全体のまとめを1段落で記載してください。明確な結論が見つからない場合は「字幕情報からは明確な結論を導き出せません」と記載してください。

# 重要な注意事項
- 提供された字幕情報のみを使用し、タイトルや説明文などの他の情報は一切使用せず、それ以外の情報も推測しないでください。
- 情報が不十分な場合は、不足していることを正直に記載してください。
- 要約は事実に基づき、中立的な表現で作成してください。
- 各セクションのヘッダーを明確に表示してください（例: 「主なトピック」、「重要なポイント」、「結論」）
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
        }],
        generationConfig: {
          temperature: 0.1, // より低い温度で事実に基づいた応答を促進
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1024
        }
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
