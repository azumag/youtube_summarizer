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

// 動画の字幕を取得する関数
async function fetchVideoCaption(videoId) {
  try {
    // 字幕を取得するためのURLを構築
    // 注: YouTube Data APIを使用せずに字幕を取得する方法
    const captionUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    // 新しいタブで字幕ページを開く
    return new Promise((resolve) => {
      chrome.tabs.create({ url: captionUrl, active: false }, async (tab) => {
        // ページが読み込まれるのを待つ
        await new Promise(r => setTimeout(r, 3000));
        
        // 字幕を取得するスクリプトを実行
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: extractCaptionsFromPage
        }, (results) => {
          // タブを閉じる
          chrome.tabs.remove(tab.id);
          
          if (chrome.runtime.lastError || !results || !results[0]) {
            console.warn("字幕の取得に失敗しました", chrome.runtime.lastError);
            resolve(""); // 空の文字列を返す
          } else {
            resolve(results[0].result || "");
          }
        });
      });
    });
  } catch (error) {
    console.error("字幕取得中にエラーが発生しました", error);
    return "";
  }
}

// ページから字幕を抽出する関数（コンテンツスクリプトとして実行）
function extractCaptionsFromPage() {
  try {
    // 字幕トラックの取得を試みる
    const videoElement = document.querySelector('video');
    if (!videoElement) return "";
    
    // トラックリストから字幕テキストを収集
    let captionText = "";
    
    // 字幕がある場合は、それを取得
    // 注: これは簡易的な方法で、すべてのケースで動作するわけではありません
    const transcriptItems = document.querySelectorAll('ytd-transcript-segment-renderer');
    if (transcriptItems && transcriptItems.length > 0) {
      captionText = Array.from(transcriptItems)
        .map(item => {
          const text = item.querySelector('#content').textContent || '';
          return text.trim();
        })
        .join(' ');
    }
    
    // 代替手段：YouTubeはトランスクリプトボタンをクリックしないと表示されない場合がある
    if (!captionText) {
      // トランスクリプトボタンを探す
      const transcriptButton = Array.from(document.querySelectorAll('button'))
        .find(button => button.textContent.includes('文字起こし') || 
                       button.textContent.includes('transcript') || 
                       button.textContent.includes('Transcript'));
      
      if (transcriptButton) {
        transcriptButton.click();
        // クリック後に少し待つ
        setTimeout(() => {
          const transcriptItems = document.querySelectorAll('ytd-transcript-segment-renderer');
          if (transcriptItems && transcriptItems.length > 0) {
            captionText = Array.from(transcriptItems)
              .map(item => {
                const text = item.querySelector('#content').textContent || '';
                return text.trim();
              })
              .join(' ');
          }
        }, 1000);
      }
    }
    
    return captionText;
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
以下のYouTube動画の内容を正確に要約してください。

タイトル: ${videoInfo.title}
チャンネル: ${videoInfo.channelName}
公開日: ${videoInfo.publishDate || '不明'}
動画の長さ: ${videoInfo.duration || '不明'}

【説明文】
${videoInfo.description}

${captions ? `【字幕/トランスクリプト】
${captions}` : ''}

指示:
1. 動画の主なトピックと目的を簡潔に説明してください。
2. 動画内で説明されている重要なポイントを箇条書きでまとめてください。
3. 動画全体の結論や要点を記載してください。
4. 説明文や字幕に含まれていない情報は推測せず、与えられた情報のみに基づいて要約してください。
5. 最終的な要約は「主なトピック」「重要なポイント」「結論」の3つのセクションに分けて構成してください。

注意: 動画の内容が不明確な場合は、「情報が不十分です」と明記し、推測や憶測は含めないでください。
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
