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
  
  if (info.menuItemId === "summarizeYouTubeLink") {
    // リンクからの要約
    videoUrl = info.linkUrl;
  } else if (info.menuItemId === "summarizeYouTubePage") {
    // 現在のページからの要約
    videoUrl = tab.url;
  }
  
  if (!videoUrl) {
    console.error("動画URLを取得できませんでした");
    return;
  }
  
  // Gemini AIのウェブサイトを開いて要約
  openGeminiWithPrompt(videoUrl);
});

// YouTubeのURLからビデオIDを抽出する関数
function extractVideoId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

// Gemini AIのウェブサイトを開いてプロンプトを自動入力する関数
function openGeminiWithPrompt(videoUrl) {
  // 既に開いているGemini AIのタブを探す
  chrome.tabs.query({ url: "https://gemini.google.com/*" }, (tabs) => {
    const prompt = `この動画を要約して：${videoUrl}`;
    
    if (tabs.length > 0) {
      // 既存のタブが見つかった場合
      const existingTab = tabs[0];
      
      // タブをアクティブにする
      chrome.windows.update(existingTab.windowId, { focused: true });
      chrome.tabs.update(existingTab.id, { active: true });
      
      // プロンプトを入力して送信
      chrome.tabs.sendMessage(existingTab.id, {
        action: "injectPrompt",
        prompt: prompt
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("メッセージの送信に失敗しました:", chrome.runtime.lastError);
          // コンテンツスクリプトが応答しない場合は、スクリプトを直接実行
          chrome.scripting.executeScript({
            target: { tabId: existingTab.id },
            func: injectPrompt,
            args: [prompt]
          });
        }
      });
    } else {
      // 新しいウィンドウでGemini AIを開く
      chrome.windows.create({
        url: "https://gemini.google.com/app?hl=ja",
        type: "popup",
        width: 800,
        height: 700
      }, (window) => {
        // ウィンドウが作成されたら、タブIDを取得
        const tabId = window.tabs[0].id;
        
        // タブが完全に読み込まれるのを待ってからスクリプトを実行
        chrome.tabs.onUpdated.addListener(function listener(updatedTabId, changeInfo) {
          if (updatedTabId === tabId && changeInfo.status === 'complete') {
            // リスナーを削除（一度だけ実行するため）
            chrome.tabs.onUpdated.removeListener(listener);
            
            // プロンプトを入力して送信するスクリプトを実行
            setTimeout(() => {
              chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: injectPrompt,
                args: [prompt]
              });
            }, 3000); // ページが完全に読み込まれるのを待つため遅延を長めに設定
          }
        });
      });
    }
  });
}

// Gemini AIのページにプロンプトを入力して送信する関数
function injectPrompt(prompt) {
  console.log('Gemini AIページにプロンプトを注入します:', prompt);
  
  // DOM要素を探す関数
  function findElementByMultipleSelectors(selectors) {
    for (const selector of selectors) {
      try {
        const elements = document.querySelectorAll(selector);
        if (elements && elements.length > 0) {
          return elements[0];
        }
      } catch (e) {
        console.error(`セレクタ ${selector} でのエラー:`, e);
      }
    }
    return null;
  }
  
  // ページの状態をログに出力（デバッグ用）
  console.log('ページ内のテキストエリア数:', document.querySelectorAll('textarea').length);
  console.log('ページ内のボタン数:', document.querySelectorAll('button').length);
  
  // テキストエリアを探す（複数の方法を試す）
  let promptTextarea = null;
  
  // 方法1: プレースホルダーで探す
  const textareas = document.querySelectorAll('textarea');
  for (const textarea of textareas) {
    console.log('テキストエリアのプレースホルダー:', textarea.placeholder);
    if (textarea.placeholder && 
        (textarea.placeholder.includes('Gemini') || 
         textarea.placeholder.includes('質問') || 
         textarea.placeholder.includes('プロンプト') ||
         textarea.placeholder.includes('Message') ||
         textarea.placeholder.includes('メッセージ'))) {
      promptTextarea = textarea;
      console.log('プレースホルダーでテキストエリアを見つけました');
      break;
    }
  }
  
  // 方法2: 特定のセレクタで探す
  if (!promptTextarea) {
    const textareaSelectors = [
      'textarea[placeholder]',
      'textarea.message-input',
      'textarea.prompt-input',
      'textarea.gemini-input',
      'div[contenteditable="true"]',
      'div[role="textbox"]'
    ];
    
    promptTextarea = findElementByMultipleSelectors(textareaSelectors);
    if (promptTextarea) {
      console.log('セレクタでテキストエリアを見つけました');
    }
  }
  
  // 方法3: 最後のテキストエリアを使用
  if (!promptTextarea && textareas.length > 0) {
    promptTextarea = textareas[textareas.length - 1];
    console.log('最後のテキストエリアを使用します');
  }
  
  if (promptTextarea) {
    console.log('テキストエリアが見つかりました。プロンプトを入力します');
    
    // プロンプトを入力
    promptTextarea.value = prompt;
    promptTextarea.textContent = prompt; // contenteditable要素の場合
    
    // 入力イベントのみをトリガー（他のイベントは送信しない）
    promptTextarea.dispatchEvent(new Event('input', { bubbles: true }));
    
    // 送信ボタンを探す
    setTimeout(() => {
      // 送信ボタンを探す（複数の可能性があるセレクタを試す）
      const buttonSelectors = [
        'button[aria-label="送信"]',
        'button[aria-label="Submit"]',
        'button[type="submit"]',
        'button.submit-button',
        'button.send-button',
        'button svg[viewBox]', // SVGアイコンを持つボタン
        'button[data-test-id="send-button"]',
        'button.primary'
      ];
      
      const sendButton = findElementByMultipleSelectors(buttonSelectors);
      
      if (sendButton) {
        console.log('送信ボタンが見つかりました。クリックします');
        // 一度だけクリック
        sendButton.click();
        return;
      }
      
      // ボタンが見つからない場合のみ、Enterキーイベントを送信
      console.log('送信ボタンが見つかりませんでした。Enterキーを送信します');
      promptTextarea.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      }));
      
    }, 1000); // ボタンを探すまでの待機時間
  } else {
    console.error('プロンプト入力欄が見つかりませんでした。ページ構造:', document.body.innerHTML);
  }
}
