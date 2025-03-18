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

// OAuth認証を使用して字幕情報を取得する関数
async function getYouTubeCaptions(videoId) {
  try {
    // ストレージからOAuth認証トークンを取得
    const { youtubeAuthToken } = await chrome.storage.sync.get('youtubeAuthToken');
    
    if (!youtubeAuthToken) {
      console.error("YouTube API認証トークンが見つかりません");
      return "YouTube APIの認証が必要です。拡張機能のポップアップから認証を行ってください。";
    }
    
    // 字幕リストを取得
    const captionsListUrl = `https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${videoId}`;
    const captionsListResponse = await fetch(captionsListUrl, {
      headers: {
        'Authorization': `Bearer ${youtubeAuthToken}`
      }
    });
    
    // レスポンスをチェック
    if (!captionsListResponse.ok) {
      const errorData = await captionsListResponse.json();
      console.error("字幕リストの取得に失敗しました:", errorData);
      
      // トークンが無効な場合は認証エラーを返す
      if (captionsListResponse.status === 401) {
        // 無効なトークンを削除
        chrome.identity.removeCachedAuthToken({ token: youtubeAuthToken }, () => {
          chrome.storage.sync.remove('youtubeAuthToken');
        });
        return "認証の有効期限が切れています。拡張機能のポップアップから再認証を行ってください。";
      }
      
      return `字幕リストの取得に失敗しました: ${errorData.error?.message || '不明なエラー'}`;
    }
    
    const captionsData = await captionsListResponse.json();
    
    // 字幕が見つからない場合
    if (!captionsData.items || captionsData.items.length === 0) {
      return "この動画には字幕が見つかりませんでした。";
    }
    
    // 優先順位: 日本語 > 英語 > 最初の字幕
    let selectedCaption = null;
    
    // 日本語字幕を探す
    selectedCaption = captionsData.items.find(caption => 
      caption.snippet.language === 'ja' || 
      caption.snippet.language === 'jpn' ||
      caption.snippet.language === 'japanese'
    );
    
    // 日本語字幕がなければ英語字幕を探す
    if (!selectedCaption) {
      selectedCaption = captionsData.items.find(caption => 
        caption.snippet.language === 'en' || 
        caption.snippet.language === 'eng' ||
        caption.snippet.language === 'english'
      );
    }
    
    // それでも見つからなければ最初の字幕を使用
    if (!selectedCaption) {
      selectedCaption = captionsData.items[0];
    }
    
    // 字幕IDを取得
    const captionId = selectedCaption.id;
    const captionLanguage = selectedCaption.snippet.language || '不明';
    
    // 字幕をダウンロード
    const captionDownloadUrl = `https://www.googleapis.com/youtube/v3/captions/${captionId}?tfmt=srt`;
    const captionResponse = await fetch(captionDownloadUrl, {
      headers: {
        'Authorization': `Bearer ${youtubeAuthToken}`
      }
    });
    
    if (!captionResponse.ok) {
      const errorData = await captionResponse.json();
      console.error("字幕のダウンロードに失敗しました:", errorData);
      return `字幕のダウンロードに失敗しました: ${errorData.error?.message || '不明なエラー'}`;
    }
    
    // SRT形式の字幕テキストを取得
    const srtText = await captionResponse.text();
    
    // SRT形式から純粋なテキストに変換
    const plainText = parseSrtToPlainText(srtText);
    
    return `【字幕言語: ${captionLanguage}】\n\n${plainText}`;
    
  } catch (error) {
    console.error("字幕の取得中にエラーが発生しました:", error);
    return `字幕の取得中にエラーが発生しました: ${error.message}`;
  }
}

// SRT形式の字幕を純粋なテキストに変換する関数
function parseSrtToPlainText(srtText) {
  // SRTの各エントリは数字、タイムスタンプ、テキストの順に並んでいる
  const lines = srtText.split('\n');
  let plainText = '';
  let isTextLine = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // 空行はテキストブロックの終わりを示す
    if (line === '') {
      isTextLine = false;
      continue;
    }
    
    // 数字だけの行はエントリ番号
    if (/^\d+$/.test(line)) {
      continue;
    }
    
    // --> を含む行はタイムスタンプ
    if (line.includes('-->')) {
      isTextLine = true;
      continue;
    }
    
    // それ以外はテキスト行
    if (isTextLine) {
      plainText += line + ' ';
    }
  }
  
  return plainText.trim();
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
    
    const captions = await getYouTubeCaptions(videoId);
        
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

// 拡張機能の起動時にconfig.jsonを読み込む
chrome.runtime.onInstalled.addListener(() => {
  loadConfig();
});

// config.jsonを読み込む関数
function loadConfig() {
  fetch(chrome.runtime.getURL('config.json'))
    .then(response => response.json())
    .then(config => {
      // クライアントIDをストレージに保存
      chrome.storage.local.set({ oauthClientId: config.client_id }, () => {
        console.log('OAuth クライアントIDを読み込みました');
      });
    })
    .catch(error => {
      console.error('config.json の読み込みに失敗しました:', error);
    });
}
