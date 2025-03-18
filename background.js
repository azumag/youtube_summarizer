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
        // タブIDを情報に追加
        videoInfo._tabId = tab.id;
        
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

// 動画の字幕を取得する関数 - すでに開いているタブを使用するバージョン
async function fetchVideoCaption(videoId, existingTabId) {
  try {
    // 既存のタブを使って字幕を取得
    return new Promise((resolve) => {
      try {
        // ページが完全に読み込まれるのを待つ（時間を延長）
        setTimeout(async () => {
          try {
            // トランスクリプトボタンをクリックして字幕を表示するスクリプトを実行
            await chrome.scripting.executeScript({
              target: { tabId: existingTabId },
              function: openTranscriptPanel
            });
            
            // トランスクリプトパネルが開くのを待つ
            setTimeout(async () => {
              try {
                // 字幕を取得するスクリプトを実行
                const results = await chrome.scripting.executeScript({
                  target: { tabId: existingTabId },
                  function: extractCaptionsFromPage
                });
                
                if (!results || !results[0]) {
                  console.warn("字幕の取得に失敗しました");
                  resolve("");
                } else {
                  const captionText = results[0].result || "";
                  console.log("取得した字幕:", captionText.substring(0, 100) + "...");
                  resolve(captionText);
                }
              } catch (error) {
                console.error("字幕抽出中にエラーが発生しました", error);
                resolve("");
              }
            }, 2000);
          } catch (error) {
            console.error("トランスクリプトパネルの開封中にエラーが発生しました", error);
            resolve("");
          }
        }, 3000);
      } catch (e) {
        console.error("字幕取得中にエラーが発生しました", e);
        resolve("");
      }
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
    
    // videoInfoオブジェクトからタブIDを取得（動的に追加されたプロパティ）
    const existingTabId = videoInfo._tabId;
    if (!existingTabId) {
      console.error("タブIDが見つかりません");
      return "技術的なエラーが発生しました。もう一度お試しください。";
    }
    
    // 既存のタブを使用して字幕を取得
    const captions = await fetchVideoCaption(extractVideoId(videoInfo.url), existingTabId);
    
    // 字幕があるかどうかをチェック
    if (!captions || captions.trim().length === 0) {
      return "この動画には字幕情報がないため、要約を生成できません。\n\n字幕が利用可能な動画で再度お試しください。";
    }

    console.log(captions);
    
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
