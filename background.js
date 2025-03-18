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
        
        // 字幕を直接APIから取得
        try {
          // 字幕を取得
          const captions = await fetchCaptionsViaAPI(videoId);
          
          // Gemini AIで要約
          const summary = await summarizeWithGemini(videoInfo, captions, geminiApiKey);
          
          // 要約結果を表示
          displaySummary(videoId, videoInfo.title, summary);
        } catch (error) {
          console.error("字幕の取得または要約中にエラーが発生しました", error);
          displaySummary(videoId, videoInfo.title, "字幕の取得に失敗しました。この動画には字幕が提供されていないか、アクセスできません。");
        }
        
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
  // 情報取得を複数回試行するために使用する配列
  const selectors = {
    title: [
      'h1.title',
      'h1.style-scope.ytd-watch-metadata',
      '#title h1',
      '#title'
    ],
    description: [
      'meta[name="description"]',
      '#description-text',
      '#description',
      '#info-container #description'
    ],
    channelName: [
      'div#owner-name a',
      '#channel-name a',
      '#owner-name a',
      '#channel-name',
      '#owner .ytd-channel-name'
    ],
    duration: [
      '.ytp-time-duration',
      'span.ytp-time-duration',
      'span[role="text"].ytd-thumbnail-overlay-time-status-renderer'
    ],
    publishDate: [
      '#info-strings yt-formatted-string',
      '#info-text',
      '#upload-info',
      '#info-text .published-date'
    ]
  };

  // セレクタ配列から最初に見つかった要素のテキストを取得する関数
  const getTextFromSelectors = (selectorArray, attributeName = null) => {
    for (const selector of selectorArray) {
      const element = document.querySelector(selector);
      if (element) {
        if (attributeName) {
          return element[attributeName] || element.getAttribute(attributeName) || '';
        }
        return element.textContent.trim() || '';
      }
    }
    return '';
  };
  
  // YouTubeの説明欄を展開する試み
  try {
    const moreButton = document.querySelector('#description tp-yt-paper-button#expand') || 
                        document.querySelector('#description #expand') ||
                        document.querySelector('#more');
    if (moreButton) {
      moreButton.click();
      // 少し待って説明が展開されるのを待つ
      setTimeout(() => {}, 500);
    }
  } catch (e) {
    console.warn('説明の展開に失敗しました', e);
  }
  
  // 値を取得
  const title = getTextFromSelectors(selectors.title) || document.title;
  // 説明は特別な処理（metaタグの場合はcontentを取得）
  let description = '';
  const descElement = document.querySelector('meta[name="description"]');
  if (descElement) {
    description = descElement.content || '';
  } else {
    description = getTextFromSelectors(selectors.description);
  }
  
  // 他の情報を取得
  const channelName = getTextFromSelectors(selectors.channelName);
  const duration = getTextFromSelectors(selectors.duration);
  const publishDate = getTextFromSelectors(selectors.publishDate);
  
  // タグ情報を取得（SEO情報として有用）
  const metaTags = document.querySelectorAll('meta[property="og:video:tag"]');
  const tags = Array.from(metaTags).map(tag => tag.content || '').filter(Boolean);
  
  // カテゴリを取得
  const category = document.querySelector('meta[itemprop="genre"]')?.content || '';
  
  // 字幕や説明を展開するための時間を少し設ける
  return {
    title,
    description,
    channelName,
    duration,
    publishDate,
    url: window.location.href,
    tags: tags.join(', '),
    category
  };
}

// YouTubeの字幕をAPIから取得する関数
async function fetchCaptionsViaAPI(videoId) {
  try {
    // 複数の言語コードを試す
    const languageCodes = ['ja', 'ja-JP', 'en', 'en-US', 'auto'];
    let captionText = '';
    
    // 各言語で試行
    for (const lang of languageCodes) {
      // YouTubeの字幕を直接取得するURLを構築
      const captionUrl = `https://www.youtube.com/api/timedtext?lang=${lang}&v=${videoId}`;
      
      try {
        const response = await fetch(captionUrl);
        if (!response.ok) {
          continue; // この言語では取得できなかった、次の言語を試す
        }
        
        const xmlText = await response.text();
        if (xmlText && xmlText.includes('<text')) {
          // XMLから字幕テキストを抽出
          captionText = parseTimedTextXML(xmlText);
          if (captionText) {
            // 成功した場合はループを抜ける
            break;
          }
        }
      } catch (error) {
        console.warn(`言語 "${lang}" での字幕取得に失敗: ${error.message}`);
        // このエラーは無視して次の言語を試す
      }
    }
    
    // 字幕が取得できなかった場合は代替APIも試す
    if (!captionText) {
      console.log("標準APIでの字幕取得に失敗、代替APIを試行します...");
      captionText = await fetchCaptionsViaAlternativeAPI(videoId);
    }
    
    return captionText;
  } catch (error) {
    console.error("すべての字幕取得方法に失敗しました", error);
    return "";
  }
}

// 代替方法でYouTubeの字幕を取得する関数
async function fetchCaptionsViaAlternativeAPI(videoId) {
  try {
    // YouTubeの非公式APIで字幕リストを取得
    const listUrl = `https://video.google.com/timedtext?type=list&v=${videoId}`;
    const listResponse = await fetch(listUrl);
    const listXml = await listResponse.text();
    
    // 字幕トラックがあるか確認
    if (!listXml || !listXml.includes('<track')) {
      return "";
    }
    
    // 利用可能な字幕トラックから言語とトラックIDを抽出
    const trackMatches = listXml.match(/<track([^>]*)>/g);
    if (!trackMatches || trackMatches.length === 0) {
      return "";
    }
    
    // 優先順位: 日本語 > 英語 > その他
    const preferredLangs = ['ja', 'jp', 'en', ''];
    let targetTrack = null;
    
    for (const prefLang of preferredLangs) {
      // 優先言語に合致するトラックを探す
      for (const track of trackMatches) {
        if (prefLang === '' || track.toLowerCase().includes(`lang_code="${prefLang}"`)) {
          targetTrack = track;
          break;
        }
      }
      
      if (targetTrack) break;
    }
    
    if (!targetTrack) {
      // 言語指定なしで最初のトラックを試す
      targetTrack = trackMatches[0];
    }
    
    // トラックから言語コードとトラックIDを抽出
    const langMatch = targetTrack.match(/lang_code="([^"]*)"/);
    const nameMatch = targetTrack.match(/name="([^"]*)"/);
    
    if (!langMatch) {
      return "";
    }
    
    const langCode = langMatch[1];
    const trackName = nameMatch ? nameMatch[1] : "";
    
    // 特定の言語の字幕を取得
    const captionUrl = `https://video.google.com/timedtext?lang=${langCode}${trackName ? `&name=${encodeURIComponent(trackName)}` : ""}&v=${videoId}`;
    const response = await fetch(captionUrl);
    
    if (!response.ok) {
      return "";
    }
    
    const xmlText = await response.text();
    if (!xmlText || !xmlText.includes('<text')) {
      return "";
    }
    
    // XMLから字幕テキストを抽出
    return parseTimedTextXML(xmlText);
  } catch (error) {
    console.error("代替API経由での字幕取得に失敗しました", error);
    return "";
  }
}

// XML形式の字幕データからテキストを抽出する関数
function parseTimedTextXML(xmlText) {
  try {
    // XMLパーサーを使用
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "text/xml");
    
    // すべてのtextノードを取得
    const textNodes = xmlDoc.getElementsByTagName('text');
    if (!textNodes || textNodes.length === 0) {
      return "";
    }
    
    // 各テキストノードからテキストを抽出し連結
    let captionText = '';
    for (let i = 0; i < textNodes.length; i++) {
      // HTMLエンティティをデコードして追加
      const textContent = textNodes[i].textContent
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      
      if (textContent.trim()) {
        captionText += textContent.trim() + '\n';
      }
    }
    
    return captionText;
  } catch (error) {
    console.error("字幕XMLの解析に失敗しました", error);
    return "";
  }
}

// Gemini AIで要約する関数
async function summarizeWithGemini(videoInfo, captions, apiKey) {
  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    
    // 字幕があるかどうかをチェック
    if (!captions || captions.trim().length === 0) {
      return "この動画には字幕情報がないため、要約を生成できません。\n\n字幕が利用可能な動画で再度お試しください。";
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
