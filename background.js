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

// 要約中のタブIDを保持する変数（重複ウィンドウの防止用）
let processingSummaryTab = null;

// ビデオ情報を取得して要約する関数
async function fetchVideoInfoAndSummarize(videoId) {
  try {
    // 処理中の場合は重複実行しない
    if (processingSummaryTab) {
      try {
        // タブが存在するか確認
        const tab = await chrome.tabs.get(processingSummaryTab);
        // タブが存在する場合は、そのタブにフォーカス
        if (tab) {
          chrome.tabs.update(processingSummaryTab, { active: true });
          return;
        }
      } catch (error) {
        // タブが存在しない場合は処理を続行（processingSummaryTabをリセット）
        processingSummaryTab = null;
      }
    }
    
    // ストレージからAPIキーを取得
    const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
    
    if (!geminiApiKey) {
      // APIキーが設定されていない場合は設定画面を開く
      chrome.runtime.openOptionsPage();
      return;
    }
    
    // 処理中のタブを作成
    chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${videoId}`, active: false }, async (tab) => {
      // 新しいタブIDを保存
      processingSummaryTab = tab.id;
      
      try {
        // タブが完全に読み込まれるのを待つ
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // コンテンツスクリプトを実行してビデオ情報を取得
        const infoResults = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: getVideoInfo
        });
        
        if (!infoResults || !infoResults[0]) {
          throw new Error("ビデオ情報の取得に失敗しました");
        }
        
        const videoInfo = infoResults[0].result;
        
        // 字幕を取得する（同じタブで）
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: openTranscriptPanel
        });
        
        // 字幕パネルが開くのを待つ
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // 字幕を取得
        const captionResults = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: extractCaptionsFromPage
        });
        
        // タブを閉じる（要約表示前に）
        chrome.tabs.remove(tab.id);
        processingSummaryTab = null;
        
        if (!captionResults || !captionResults[0]) {
          throw new Error("字幕の取得に失敗しました");
        }
        
        const captions = captionResults[0].result;
        
        // 字幕が取得できたかチェック
        if (!captions || captions.trim().length === 0) {
          // 字幕がない場合、その旨を表示
          displaySummary(videoId, videoInfo.title, "この動画には字幕情報がないため、要約を生成できません。\n\n字幕が利用可能な動画で再度お試しください。");
          return;
        }
        
        // Gemini AIで要約
        const summary = await summarizeWithGemini(videoInfo, captions, geminiApiKey);
        
        // 要約結果を表示
        displaySummary(videoId, videoInfo.title, summary);
      } catch (error) {
        console.error("要約処理中にエラーが発生しました", error);
        
        // エラーが発生した場合はタブを閉じて処理終了
        if (processingSummaryTab) {
          chrome.tabs.remove(processingSummaryTab);
          processingSummaryTab = null;
        }
        
        displaySummary(videoId, "要約エラー", "要約処理中にエラーが発生しました。もう一度お試しください。");
      }
    });
  } catch (error) {
    console.error("要約処理の初期化中にエラーが発生しました", error);
    processingSummaryTab = null;
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

// トランスクリプトパネルを開く関数（スクリプトとして実行）
function openTranscriptPanel() {
  // このログが表示されるか確認（デバッグ用）
  console.log("トランスクリプトパネルを開く処理を開始します");
  
  try {
    // ===== 方法1: ３点メニューからトランスクリプトを開く =====
    const menuButton = document.querySelector('button.ytp-button[aria-label="その他の操作"]') || 
                      document.querySelector('button.ytp-button[aria-label="More actions"]') ||
                      document.querySelector('ytd-menu-renderer button#button') ||
                      document.querySelector('button[aria-label="More"]');
                      
    if (menuButton) {
      console.log("メニューボタンを発見しました");
      menuButton.click();
      
      // メニューが開くのを待つ
      setTimeout(() => {
        // メニュー内のトランスクリプトオプションを探す
        const transcriptItems = Array.from(document.querySelectorAll('ytd-menu-service-item-renderer, .ytp-menuitem, tp-yt-paper-item')).filter(item => 
          item.textContent.includes('文字起こし') || 
          item.textContent.includes('トランスクリプト') || 
          item.textContent.includes('transcript') || 
          item.textContent.includes('Transcript')
        );
        
        console.log(`${transcriptItems.length}個のトランスクリプト関連アイテムを発見しました`);
        
        if (transcriptItems.length > 0) {
          transcriptItems[0].click();
          console.log("トランスクリプトメニューをクリックしました");
          return;
        }
      }, 1000);
    }
    
    // ===== 方法2: 専用の文字起こしボタンを探す =====
    setTimeout(() => {
      const transcriptButton = document.querySelector('button[aria-label="字幕"]') ||
                            document.querySelector('button[aria-label="Subtitles/closed captions"]') ||
                            document.querySelector('button.ytp-subtitles-button') ||
                            document.querySelector('.caption-button');
      
      if (transcriptButton) {
        console.log("専用の字幕ボタンを発見しました");
        transcriptButton.click();
      } else {
        console.log("字幕ボタンが見つかりませんでした");
      }
    }, 1500);
    
    // ===== 方法3: 右クリックコンテキストメニューを試す =====
    setTimeout(() => {
      // 動画エレメントを取得
      const videoElement = document.querySelector('video');
      if (videoElement) {
        console.log("動画要素を発見、コンテキストメニューを試みます");
        
        // 右クリックイベントをシミュレート
        const contextMenuEvent = new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 2,
          buttons: 2,
        });
        
        videoElement.dispatchEvent(contextMenuEvent);
        
        // コンテキストメニューが表示されるのを待つ
        setTimeout(() => {
          // コンテキストメニュー内の字幕アイテムを探す
          const captionMenuItem = Array.from(document.querySelectorAll('.ytp-contextmenu .ytp-menuitem')).find(item => 
            item.textContent.includes('字幕') || 
            item.textContent.includes('Subtitles') || 
            item.textContent.includes('Captions')
          );
          
          if (captionMenuItem) {
            console.log("コンテキストメニューで字幕アイテムを発見しました");
            captionMenuItem.click();
          } else {
            console.log("コンテキストメニューに字幕アイテムがありませんでした");
          }
        }, 500);
      }
    }, 2000);
    
  } catch (error) {
    console.error("トランスクリプトパネルを開く際にエラーが発生しました", error);
  }
  
  // 強制的に字幕トラックを有効化する試み
  setTimeout(() => {
    try {
      const video = document.querySelector('video');
      if (video && video.textTracks && video.textTracks.length > 0) {
        console.log(`ビデオに${video.textTracks.length}個のテキストトラックがあります`);
        for (let i = 0; i < video.textTracks.length; i++) {
          if (video.textTracks[i].kind === 'subtitles' || video.textTracks[i].kind === 'captions') {
            video.textTracks[i].mode = 'showing';
            console.log(`テキストトラック${i}を表示状態にしました`);
          }
        }
      } else {
        console.log("ビデオにテキストトラックがありません");
      }
    } catch (e) {
      console.error("テキストトラックの操作に失敗しました", e);
    }
  }, 2500);
}

// ページから字幕を抽出する関数（コンテンツスクリプトとして実行）
function extractCaptionsFromPage() {
  console.log("字幕抽出処理を開始します");
  
  try {
    // ==== 方法1: 字幕パネルから抽出 ====
    // トランスクリプト要素のセレクタを試す
    const transcriptSelectors = [
      'ytd-transcript-segment-renderer',
      'ytd-transcript-body-renderer',
      '.ytd-transcript-renderer',
      '.ytd-transcript-segment-list-renderer',
      '.cue-group', // 新しいUI
      '.segment-text',
      '.caption-visual-line',
      '.ytd-engagement-panel-section-list-renderer' // パネル全体
    ];
    
    let captionElements = [];
    
    // 各セレクタを試す
    for (const selector of transcriptSelectors) {
      const elements = document.querySelectorAll(selector);
      if (elements && elements.length > 0) {
        console.log(`セレクタ "${selector}" で字幕要素を${elements.length}個見つけました`);
        captionElements = Array.from(elements);
        break;
      }
    }
    
    if (captionElements.length > 0) {
      // 字幕要素が見つかった場合
      const textResults = captionElements
        .map(item => {
          // 異なる構造に対応するため複数のセレクタを試す
          const textElement = 
            item.querySelector('#content') || 
            item.querySelector('.segment-text') || 
            item.querySelector('.caption-visual-line') || 
            item;
          
          return textElement ? textElement.textContent.trim() : '';
        })
        .filter(text => text); // 空の文字列を除外
      
      if (textResults.length > 0) {
        console.log(`${textResults.length}行の字幕テキストを抽出しました`);
        return textResults.join('\n'); // 改行で結合して構造を保持
      } else {
        console.log("字幕要素は見つかりましたが、テキストを抽出できませんでした");
      }
    } else {
      console.log("字幕要素が見つかりませんでした");
    }
    
    // ==== 方法2: ビデオ要素から字幕を取得 ====
    const videoElement = document.querySelector('video');
    if (videoElement && videoElement.textTracks && videoElement.textTracks.length > 0) {
      console.log(`ビデオに${videoElement.textTracks.length}個のテキストトラックがあります`);
      
      for (let i = 0; i < videoElement.textTracks.length; i++) {
        const track = videoElement.textTracks[i];
        
        if (track.kind === 'subtitles' || track.kind === 'captions') {
          console.log(`テキストトラック${i}は字幕です`);
          track.mode = 'showing';
          
          // 少し待機して字幕が読み込まれるのを待つ
          console.log(`テキストトラック${i}のcues: ${track.cues ? track.cues.length : 'null'}`);
          
          if (track.cues && track.cues.length > 0) {
            const captionLines = [];
            for (let j = 0; j < track.cues.length; j++) {
              captionLines.push(track.cues[j].text);
            }
            
            console.log(`テキストトラック${i}から${captionLines.length}行の字幕を抽出しました`);
            return captionLines.join('\n');
          }
        }
      }
    }
    
    // ==== 方法3: ページのHTMLから字幕データを直接探す ====
    const pageHtml = document.documentElement.outerHTML;
    const captionDataMatch = pageHtml.match(/"captionTracks":\s*(\[.*?\])/);
    
    if (captionDataMatch && captionDataMatch[1]) {
      try {
        const captionJson = JSON.parse(captionDataMatch[1].replace(/\\"/g, '"').replace(/\\\\u/g, '\\u'));
        
        if (captionJson && captionJson.length > 0) {
          console.log(`ページから${captionJson.length}個の字幕トラックを発見しました`);
          
          // 字幕URLがある場合、それを返す（字幕URLは後で別の方法で取得する必要がある）
          const captionUrls = captionJson.map(track => track.baseUrl || track.url || '').filter(Boolean);
          
          if (captionUrls.length > 0) {
            console.log(`${captionUrls.length}個の字幕URLを発見しました`);
            return `CAPTION_URLS:${JSON.stringify(captionUrls)}`;
          }
        }
      } catch (e) {
        console.error("字幕JSONの解析に失敗しました", e);
      }
    }
    
    // ==== 方法4: 最後の手段として字幕が有効かどうかだけでも取得 ====
    const hasCaptionButton = !!document.querySelector('.ytp-subtitles-button[aria-pressed="true"]');
    const hasTranscriptButton = !!document.querySelector('[aria-label="字幕"]') || 
                              !!document.querySelector('[aria-label="Subtitles/closed captions"]');
    
    if (hasCaptionButton || hasTranscriptButton) {
      console.log("字幕ボタンが存在しますが、内容を取得できませんでした");
      return "CAPTION_AVAILABLE:字幕が存在しますが、内容を抽出できませんでした。";
    }
    
    // 字幕が見つからなかった場合
    console.log("字幕データが見つかりませんでした");
    return "";
  } catch (error) {
    console.error("字幕抽出中にエラーが発生しました", error);
    return "";
  }
}

// Gemini AIで要約する関数
async function summarizeWithGemini(videoInfo, captions, apiKey) {
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
