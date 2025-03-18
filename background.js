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

// 動画の字幕を取得する関数
async function fetchVideoCaption(videoId) {
  try {
    // 字幕を取得するためのURLを構築
    const captionUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    // 新しいタブで字幕ページを開く
    return new Promise((resolve) => {
      chrome.tabs.create({ url: captionUrl, active: false }, async (tab) => {
        try {
          // ページが完全に読み込まれるのを待つ（時間を延長）
          await new Promise(r => setTimeout(r, 5000));
          
          // トランスクリプトボタンをクリックして字幕を表示するスクリプトを実行
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: openTranscriptPanel
          });
          
          // トランスクリプトパネルが開くのを待つ
          await new Promise(r => setTimeout(r, 2000));
          
          // 字幕を取得するスクリプトを実行
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: extractCaptionsFromPage
          }, (results) => {
            try {
              // タブを閉じる
              chrome.tabs.remove(tab.id);
              
              if (chrome.runtime.lastError || !results || !results[0]) {
                console.warn("字幕の取得に失敗しました", chrome.runtime.lastError);
                resolve(""); // 空の文字列を返す
              } else {
                const captionText = results[0].result || "";
                console.log("取得した字幕:", captionText.substring(0, 100) + "...");
                resolve(captionText);
              }
            } catch (e) {
              console.error("字幕処理中にエラーが発生しました", e);
              chrome.tabs.remove(tab.id);
              resolve("");
            }
          });
        } catch (e) {
          console.error("字幕取得中にエラーが発生しました", e);
          chrome.tabs.remove(tab.id);
          resolve("");
        }
      });
    });
  } catch (error) {
    console.error("字幕取得処理中にエラーが発生しました", error);
    return "";
  }
}

// トランスクリプトパネルを開く関数
function openTranscriptPanel() {
  try {
    // トランスクリプトボタンを探す
    const findTranscriptButton = () => {
      // さまざまなセレクタでトランスクリプトボタンを検索
      const selectors = [
        'button[aria-label="Show transcript"]',
        'button[aria-label="文字起こしを表示"]',
        'ytd-menu-renderer yt-button-shape button',
        '#items ytd-menu-service-item-renderer',
        'button.ytp-subtitles-button',
        // メニュー内のテキストで検索
        ...Array.from(document.querySelectorAll('button')).filter(b => 
          b.textContent.includes('transcript') || 
          b.textContent.includes('文字起こし') || 
          b.textContent.includes('Transcript') ||
          b.textContent.includes('Caption')
        )
      ];
      
      for (const selector of selectors) {
        const elements = typeof selector === 'string' 
          ? Array.from(document.querySelectorAll(selector))
          : [selector];
          
        for (const el of elements) {
          if (el && (
              el.textContent.includes('transcript') || 
              el.textContent.includes('文字起こし') ||
              // アイコンだけのボタンの場合はaria-labelで判断
              el.getAttribute('aria-label')?.includes('transcript') ||
              el.getAttribute('aria-label')?.includes('文字起こし')
            )) {
            return el;
          }
        }
      }
      
      // メニューボタンの探索（...ボタン）
      const menuButtons = Array.from(document.querySelectorAll('button')).filter(b => 
        b.textContent.includes('More') || 
        b.textContent.includes('その他') ||
        b.getAttribute('aria-label')?.includes('More actions') ||
        b.getAttribute('aria-label')?.includes('その他の操作')
      );
      
      return menuButtons[0];
    };
    
    const transcriptButton = findTranscriptButton();
    
    if (transcriptButton) {
      transcriptButton.click();
      console.log("トランスクリプトボタンをクリックしました");
      
      // メニューが表示されるのを待つ
      setTimeout(() => {
        // メニュー内のトランスクリプトオプションを探す
        const transcriptOption = Array.from(document.querySelectorAll('ytd-menu-service-item-renderer')).find(
          item => item.textContent.includes('transcript') || 
                 item.textContent.includes('文字起こし')
        );
        
        if (transcriptOption) {
          transcriptOption.click();
          console.log("トランスクリプトオプションをクリックしました");
        }
      }, 1000);
    }
  } catch (error) {
    console.error("トランスクリプトパネルを開く際にエラーが発生しました", error);
  }
}

// ページから字幕を抽出する関数（コンテンツスクリプトとして実行）
function extractCaptionsFromPage() {
  try {
    // 異なる種類のトランスクリプト要素セレクタを試す
    const selectors = [
      'ytd-transcript-segment-renderer',
      '.ytd-transcript-segment-renderer',
      '.segment-text',
      '.caption-visual-line',
      '.caption-window',
      '.ytp-caption-segment'
    ];
    
    let captionElements = [];
    
    // 各セレクタを試す
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      if (elements && elements.length > 0) {
        captionElements = Array.from(elements);
        break;
      }
    }
    
    // 字幕要素が見つかった場合
    if (captionElements.length > 0) {
      return captionElements
        .map(item => {
          // 異なる構造に対応するため複数のセレクタを試す
          const textElement = 
            item.querySelector('#content') || 
            item.querySelector('.segment-text') || 
            item.querySelector('.caption-visual-line') || 
            item;
          
          return textElement ? textElement.textContent.trim() : '';
        })
        .filter(text => text) // 空の文字列を除外
        .join('\n'); // 空白ではなく改行で結合して構造を保持
    }
    
    // 代替手段：ビデオ要素から字幕を取得
    const videoElement = document.querySelector('video');
    if (videoElement && videoElement.textTracks && videoElement.textTracks.length > 0) {
      for (const track of videoElement.textTracks) {
        if (track.kind === 'subtitles' || track.kind === 'captions') {
          track.mode = 'showing';
          const cues = track.cues;
          if (cues && cues.length > 0) {
            return Array.from(cues)
              .map(cue => cue.text)
              .join('\n');
          }
        }
      }
    }
    
    // 説明からキーワードを抽出（字幕が見つからない場合のフォールバック）
    const description = document.querySelector('meta[name="description"]')?.content || 
                        document.querySelector('#description-text')?.textContent || 
                        document.querySelector('#description')?.textContent || '';
    
    return description;
  } catch (error) {
    console.error("字幕抽出中にエラーが発生しました", error);
    return "";
  }
}

// Gemini AIで要約する関数
async function summarizeWithGemini(videoInfo, apiKey) {
  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    
    // 字幕を取得
    const captions = await fetchVideoCaption(extractVideoId(videoInfo.url));
    
    // 最適化されたプロンプト
    const prompt = `
あなたは正確な要約を生成する専門家です。以下のYouTube動画の内容を提供された情報のみに基づいて要約してください。推測や憶測は厳禁です。

# 動画情報
URL: ${videoInfo.url}
タイトル: ${videoInfo.title}
チャンネル: ${videoInfo.channelName}
公開日: ${videoInfo.publishDate || '不明'}
動画の長さ: ${videoInfo.duration || '不明'}
${videoInfo.tags ? `タグ: ${videoInfo.tags}` : ''}
${videoInfo.category ? `カテゴリ: ${videoInfo.category}` : ''}

# 動画の説明文
${videoInfo.description || '説明文なし'}

${captions ? `# 動画の文字起こし／字幕
${captions}` : '# 動画の文字起こし／字幕\n利用可能な字幕はありません。'}

# 要約の構成
以下の構成で要約を作成してください：

## 主なトピック
動画の主題と目的を1-2段落で簡潔に説明してください。提供された情報から明確に判断できない場合は「動画のトピックは情報不足のため明確に特定できません」と記載してください。

## 重要なポイント
動画内で明示的に言及されている主要なポイントを箇条書きでまとめてください。各ポイントは簡潔で明確であること。提供された情報から明確なポイントが抽出できない場合は「提供された情報からは重要なポイントを特定できません」と記載してください。

## 結論
動画の結論部分または全体のまとめを1段落で記載してください。明確な結論が見つからない場合は「提供された情報からは明確な結論を導き出せません」と記載してください。

# 重要な注意事項
- 提供された説明文と字幕の情報のみを使用し、それ以外の情報は推測しないでください。
- 情報が不十分な場合は、不足していることを正直に記載してください。
- 要約は事実に基づき、中立的な表現で作成してください。
- 情報が矛盾している場合は、その矛盾点を明記してください。
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
          temperature: 0.2, // 低い温度で事実に基づいた応答を促進
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
