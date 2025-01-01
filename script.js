class AISearchEngine {
    constructor() {
        this.apiKey = '9cbb69d66a5f4ce284a1e645fda637cd.50n5h0AWoCIZWofH';
        this.webSearchUrl = 'https://open.bigmodel.cn/api/paas/v4/tools';
        this.glmApiUrl = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
        this.assistantUrl = 'https://open.bigmodel.cn/api/paas/v4/assistant';
        this.assistantId = '659e54b1b8006379b4b2abd6';
        
        // 修改重试配置
        this.requestQueue = [];
        this.isProcessing = false;
        this.retryDelay = 2000;     // 初始重试延迟2秒
        this.maxRetries = 5;        // 增加最大重试次数
        this.retryMultiplier = 1.5; // 重试延迟倍数
        
        // 添加流式响应状态追踪
        this.streamStatus = {
            requestId: null,
            startTime: null,
            tokensUsed: {
                prompt: 0,
                completion: 0,
                total: 0
            }
        };
        
        this.initializeElements();
        this.bindEvents();
    }

    initializeElements() {
        this.searchInput = document.getElementById('searchInput');
        this.searchBtn = document.getElementById('searchBtn');
        this.quickSearchResults = document.getElementById('quickSearchResults');
        this.subQuestions = document.getElementById('subQuestions');
        this.deepSearchResults = document.getElementById('deepSearchResults');
        
        // 按钮事件
        this.editBtn = document.getElementById('editBtn');
        this.downloadBtn = document.getElementById('downloadBtn');
        this.splitBtn = document.getElementById('splitBtn');
    }

    bindEvents() {
        this.searchBtn.addEventListener('click', () => this.handleSearch());
        this.editBtn.addEventListener('click', () => this.handleEdit());
        this.downloadBtn.addEventListener('click', () => this.handleDownload());
        this.splitBtn.addEventListener('click', () => this.handleSplit());
    }

    async handleSearch() {
        const query = this.searchInput.value.trim();
        if (!query) return;

        try {
            // 显示加载状态
            this.showLoading(this.quickSearchResults);
            this.showLoading(this.subQuestions);
            this.showLoading(this.deepSearchResults);

            // Step 1: 快速搜索
            const quickSearchResult = await this.performWebSearch(query);
            this.hideLoading(this.quickSearchResults);
            this.displayQuickSearchResults(quickSearchResult);

            // Step 2: 模型分析
            const subQuestions = await this.analyzeWithGLM(query);
            this.hideLoading(this.subQuestions);
            this.displaySubQuestions(subQuestions);

            // Step 3: 深度搜索
            const deepSearchResults = await this.performDeepSearch(subQuestions);
            this.hideLoading(this.deepSearchResults);
            this.displayDeepSearchResults(deepSearchResults);
        } catch (error) {
            console.error('搜索过程出错:', error);
            this.showError('搜索过程出错，请稍后重试');
        }
    }

    async performWebSearch(query) {
        try {
            const data = await this.queueRequest(this.webSearchUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tool: 'web-search-pro',
                    messages: [{
                        role: 'user',
                        content: query
                    }],
                    stream: false
                })
            });

            const searchResults = data.choices?.[0]?.message?.tool_calls?.find(
                call => call.type === 'search_result'
            )?.search_result || [];

            return searchResults;
        } catch (error) {
            console.error('WebSearch API 调用失败:', error);
            this.showError('快速搜索失败，请稍后重试');
            return [];
        }
    }

    async analyzeWithGLM(query) {
        try {
            const data = await this.queueRequest(this.glmApiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: "glm-4v-flash", // 更新为正确的模型编码
                    messages: [
                        {
                            role: "system",
                            content: `您是一个问题分析专家。请将用户的问题拆分为多个具体的子问题，并以以下JSON格式返回：
                            {
                                "questions": [
                                    "子问题1",
                                    "子问题2",
                                    "子问题3"
                                ]
                            }
                            注意：请确保返回的是有效的JSON格式。`
                        },
                        {
                            role: "user",
                            content: query
                        }
                    ],
                    temperature: 0.3, // 降低温度以获得更稳定的输出
                    top_p: 0.95,
                    stream: false
                })
            });

            // 解析返回的内容
            const content = data.choices?.[0]?.message?.content;
            if (content) {
                try {
                    // 改进JSON匹配正则表达式
                    const jsonMatch = content.match(/\{[\s\S]*?\}(?!\s*[,\]}])/);
                    if (jsonMatch) {
                        const parsedQuestions = JSON.parse(jsonMatch[0]);
                        if (Array.isArray(parsedQuestions.questions) && parsedQuestions.questions.length > 0) {
                            return parsedQuestions.questions;
                        }
                    }
                } catch (e) {
                    console.error('解析子问题JSON失败:', e);
                    console.log('原始返回内容:', content);
                }
            }
            return [query];
        } catch (error) {
            console.error('GLM API 调用失败:', error);
            this.showError('问题分析失败，请稍后重试');
            return [query];
        }
    }

    async performDeepSearch(subQuestions) {
        try {
            // 首先发送原始分析请求
            const response = await fetch(this.assistantUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream'
                },
                body: JSON.stringify({
                    assistant_id: this.assistantId,
                    model: "glm-4-assistant",
                    messages: [{
                        role: "user",
                        content: [{
                            type: "text",
                            text: this.buildStructuredQuery(subQuestions)
                        }]
                    }],
                    stream: true
                })
            });

            if (!response.ok) {
                throw new Error(`API 错误: ${response.status}`);
            }

            // 初始化结果容器
            let currentResults = this.initializeSearchResults();
            
            // 处理流式响应
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const {done, value} = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, {stream: true});
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6).trim());
                            if (!data) continue;

                            if (data.choices?.[0]?.delta) {
                                const delta = data.choices[0].delta;
                                
                                if (delta.role === 'tool' && delta.tool_calls) {
                                    for (const call of delta.tool_calls) {
                                        if (call.type === 'web_browser' && call.web_browser?.outputs) {
                                            currentResults.searchResults.push(...call.web_browser.outputs);
                                        }
                                    }
                                }
                                
                                if (delta.content) {
                                    currentResults.fullResponse += delta.content;
                                    this.tryParseAndUpdateResults(currentResults);
                                }
                            }
                        } catch (e) {
                            console.warn('解析SSE数据失败:', e);
                        }
                    }
                }
            }

            // 生成思维导图
            await this.generateMindMap(currentResults.fullResponse);

        } catch (error) {
            console.error('深度搜索失败:', error);
            this.showDeepSearchError(error.message);
        }
    }

    buildStructuredQuery(questions) {
        // 提取第一个问题作为主要问题
        const mainQuestion = questions[0];
        // 其余问题作为附加问题
        const additionalQuestions = questions.slice(1);

        return `
            搜索最新的联网信息，详细回答问题：${mainQuestion}
            ${additionalQuestions.length > 0 ? `
            同时搜索并回答以下问题：
            ${additionalQuestions.map(q => `- ${q}`).join('\n')}
            ` : ''}

            按照以下的markdown格式回答每个问题：
            #问题
            [问题内容]

            ##回答
            [基于最新搜索结果的详细回答]

            ###分析点
            [关键分析要点，包括数据支持和参考来源]

            注意：
            1. 每个问题的回答都需要基于最新的互联网搜索结果
            2. 回答要详细、准确，并突出关键分析点
            3. 请确保引用可靠的信息来源，使用[ref_x]标注引用
        `;
    }

    formatDeepSearchResults(searchResults, analysisText) {
        try {
            const results = [];
            
            // 直接添加原始文本，不做任何筛选或处理
            if (analysisText) {
                results.push({
                    title: '分析结果',
                    content: `
                        <div class="deep-search-answer">
                            <div class="stream-content">${analysisText}</div>
                        </div>
                    `
                });
            }

            // 添加参考资料
            if (searchResults?.length > 0) {
                results.push({
                    title: '参考资料',
                    content: `
                        <div class="deep-search-answer">
                            ${searchResults.map(result => `
                                <div class="search-result-item">
                                    <h4><a href="${result.link}" target="_blank">${result.title || '未知标题'}</a></h4>
                                    <p>${result.content || '暂无内容'}</p>
                                    ${result.refer ? `<span class="reference-tag">${result.refer}</span>` : ''}
                                </div>
                            `).join('')}
                        </div>
                    `
                });
            }

            return results;
        } catch (error) {
            console.error('格式化深度搜索结果失败:', error);
            return [];
        }
    }

    markdownToHtml(markdown) {
        if (!markdown) return '';
        
        // 如果已经是HTML，直接返回
        if (markdown.trim().startsWith('<')) {
            return markdown;
        }
        
        return markdown
            // 处理引用标记
            .replace(/\[(\d+†source)\]/g, '<span class="reference-tag">[$1]</span>')
            // 处理粗体
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            // 处理斜体
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            // 处理列表项
            .replace(/^\s*[-•]\s+(.*?)$/gm, '<li>$1</li>')
            .replace(/^\s*\d+\.\s+(.*?)$/gm, '<li>$1</li>')
            // 将连续的列表项包装在适当的列表标签中
            .replace(/(<li>.*?<\/li>)+/g, match => {
                const isOrdered = /^\d+\./.test(match);
                return `<${isOrdered ? 'ol' : 'ul'}>${match}</${isOrdered ? 'ol' : 'ul'}>`;
            })
            // 处理段落
            .split(/\n\n+/).map(p => {
                const trimmed = p.trim();
                if (!trimmed) return '';
                if (trimmed.startsWith('<')) return trimmed;
                return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
            }).join('\n');
    }

    displayQuickSearchResults(results) {
        if (!results.length) {
            this.quickSearchResults.innerHTML = '<div class="no-results">暂无搜索结果</div>';
            return;
        }

        this.quickSearchResults.innerHTML = results.map(result => `
            <div class="result-item">
                <h3>${result.title || '搜索结果'}</h3>
                <p>${result.content || '暂无内容'}</p>
                ${result.link ? `
                    <div class="result-meta">
                        <a href="${result.link}" target="_blank" class="source-link">
                            ${result.media ? `<span class="media-source">${result.media}</span>` : ''}
                            查看来源 ${result.refer ? `[${result.refer}]` : ''}
                        </a>
                    </div>
                ` : ''}
            </div>
        `).join('');
    }

    displaySubQuestions(questions) {
        if (!questions.length) {
            this.subQuestions.innerHTML = '<div class="no-results">暂无子问题</div>';
            return;
        }

        this.subQuestions.innerHTML = `
            <div class="sub-questions-container">
                ${questions.map((q, index) => `
                    <div class="question-item">
                        <span class="question-number">${index + 1}.</span>
                        <span class="question-content">${q}</span>
                    </div>
                `).join('')}
            </div>
        `;
    }

    displayDeepSearchResults(results) {
        if (!results.length) {
            this.deepSearchResults.innerHTML = '<div class="no-results">暂无深度分析结果</div>';
            return;
        }

        this.deepSearchResults.innerHTML = results.map(result => `
            <div class="deep-result-item">
                <h3>${result.title}</h3>
                <div class="deep-result-content">
                    ${result.content}
                </div>
            </div>
        `).join('');
    }

    handleEdit() {
        // 实现编辑功能
        console.log('编辑功能待实现');
    }

    handleDownload() {
        // 实现下载报告功能
        console.log('下载功能待实现');
    }

    handleSplit() {
        // 实现问题拆分功能
        console.log('拆分功能待实现');
    }

    showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = message;
        errorDiv.style.cssText = `
            background-color: #fff2f0;
            border: 1px solid #ffccc7;
            color: #ff4d4f;
            padding: 8px 12px;
            border-radius: 4px;
            margin: 10px 0;
        `;
        
        // 显示错误信息
        this.quickSearchResults.prepend(errorDiv);
        
        // 3秒后自动移除错误提示
        setTimeout(() => errorDiv.remove(), 3000);
    }

    parseSubQuestions(content) {
        // 将GLM返回的文本解析为子问题数组
        const questions = content.split('\n')
            .filter(line => line.trim())
            .map(line => line.replace(/^\d+[\.\、]\s*/, '').trim());
        return questions;
    }

    // 添加请求队列处理方法
    async processQueue() {
        if (this.isProcessing || this.requestQueue.length === 0) return;
        
        this.isProcessing = true;
        const { request, resolve, reject, retries = 0 } = this.requestQueue.shift();
        
        try {
            const response = await fetch(request.url, request.options);
            
            if (response.status === 429 && retries < this.maxRetries) {
                // 计算下一次重试的延迟时间
                const nextDelay = this.retryDelay * Math.pow(this.retryMultiplier, retries);
                console.log(`请求被限制，${nextDelay}ms后重试，剩余重试次数：${this.maxRetries - retries}`);
                
                await new Promise(r => setTimeout(r, nextDelay));
                this.requestQueue.unshift({ 
                    request, 
                    resolve, 
                    reject, 
                    retries: retries + 1 
                });
            } else if (!response.ok) {
                throw new Error(`API 错误: ${response.status}`);
            } else {
                resolve(await response.json());
            }
        } catch (error) {
            reject(error);
        } finally {
            this.isProcessing = false;
            setTimeout(() => this.processQueue(), 500); // 添加处理间隔
        }
    }

    // 添加请求到队列的方法
    async queueRequest(url, options) {
        return new Promise((resolve, reject) => {
            this.requestQueue.push({
                request: { url, options },
                resolve,
                reject
            });
            this.processQueue();
        });
    }

    showLoading(element) {
        element.innerHTML = '<div class="loading">正在加载中...</div>';
    }

    hideLoading(element) {
        const loading = element.querySelector('.loading');
        if (loading) {
            loading.remove();
        }
    }

    // 添加显示流式状态的方法
    updateStreamStatus(element, status) {
        const statusDiv = element.querySelector('.stream-status') || (() => {
            const div = document.createElement('div');
            div.className = 'stream-status';
            element.prepend(div);
            return div;
        })();

        statusDiv.innerHTML = `
            <div class="status-info">
                <span class="status-badge ${status.toLowerCase()}">${status}</span>
                ${this.streamStatus.startTime ? `
                    <span class="time-elapsed">
                        ${Math.floor((Date.now() - this.streamStatus.startTime) / 1000)}s
                    </span>
                ` : ''}
                ${this.streamStatus.tokensUsed.total ? `
                    <span class="token-info">
                        Tokens: ${this.streamStatus.tokensUsed.total}
                    </span>
                ` : ''}
            </div>
        `;
    }

    // 初始化结果容器
    initializeSearchResults() {
        return {
            searchResults: [],
            fullResponse: '',
            formattedResults: [],
            lastProcessedLength: 0
        };
    }

    // 修改tryParseAndUpdateResults方法
    tryParseAndUpdateResults(results) {
        try {
            if (!results.fullResponse) return;

            // 获取或创建结果容器
            let resultsContainer = this.deepSearchResults.querySelector('.deep-results-container');
            if (!resultsContainer) {
                resultsContainer = document.createElement('div');
                resultsContainer.className = 'deep-results-container';
                this.deepSearchResults.innerHTML = '';
                this.deepSearchResults.appendChild(resultsContainer);
            }

            // 获取或创建流式输出容器
            let streamContent = resultsContainer.querySelector('.stream-content');
            if (!streamContent) {
                streamContent = document.createElement('div');
                streamContent.className = 'stream-content';
                resultsContainer.insertBefore(streamContent, resultsContainer.firstChild);
            }

            // 格式化并显示主要内容
            const formattedText = this.formatResponseText(results.fullResponse);
            streamContent.innerHTML = formattedText;

            // 获取或创建思维导图容器
            let mindMapContainer = resultsContainer.querySelector('.mind-map-container');
            if (!mindMapContainer) {
                mindMapContainer = document.createElement('div');
                mindMapContainer.className = 'mind-map-container';
                // 将思维导图插入到流式输出之后
                streamContent.after(mindMapContainer);
            }

            // 如果有搜索结果，显示在思维导图下方
            let referencesContainer = resultsContainer.querySelector('.references-container');
            if (results.searchResults?.length > 0) {
                if (!referencesContainer) {
                    referencesContainer = document.createElement('div');
                    referencesContainer.className = 'references-container';
                    resultsContainer.appendChild(referencesContainer);
                }
                referencesContainer.innerHTML = `
                    <h3>参考资料</h3>
                    <div class="search-results-list">
                        ${results.searchResults.map(result => `
                            <div class="search-result-item">
                                <h4><a href="${result.link}" target="_blank">${result.title || '未知标题'}</a></h4>
                                <p>${result.content || '暂无内容'}</p>
                                ${result.refer ? `<sup class="reference">[参考${result.refer}]</sup>` : ''}
                            </div>
                        `).join('')}
                    </div>
                `;
            }

            // 在流式输出完成后生成思维导图
            if (results.fullResponse.includes('###')) {
                this.generateMindMap(results.fullResponse);
            }

        } catch (e) {
            console.error('显示响应失败:', e);
            this.showDeepSearchError(`显示失败: ${e.message}`);
        }
    }

    // 添加格式化响应文本的辅助方法
    formatResponseText(text) {
        // 预处理文本，移除【】中的内容
        let processedText = text
            .replace(/【[^】]*】/g, '')  // 移除【】中的内容
            .replace(/(?:^|\n)#\s*问题/g, '\n# 问题')  // 统一问题标记格式
            .replace(/(?:^|\n)##\s*回答/g, '\n## 回答')  // 统一回答标记格式
            .replace(/(?:^|\n)###\s*分析点/g, '\n### 分析点')  // 统一分析点标记格式
            .trim();

        // 格式化文本
        return processedText
            .replace(/(?:^|\n)#\s+([^\n]+)/g, '<h2 class="section-title">$1</h2>')  // 处理一级标题
            .replace(/(?:^|\n)##\s+([^\n]+)/g, '<h3 class="section-subtitle">$1</h3>')  // 处理二级标题
            .replace(/(?:^|\n)###\s+([^\n]+)/g, '<h4 class="section-analysis">$1</h4>')  // 处理三级标题
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')  // 处理粗体
            .replace(/\[(\d+†source)\]/g, '<sup class="reference">[参考$1]</sup>')  // 处理引用
            .replace(/\n/g, '<br>');  // 处理换行
    }

    // 添加新的显示方法
    displayRawContent(content) {
        // 检查是否已有结果容器
        let resultsContainer = this.deepSearchResults.querySelector('.deep-results-container');
        if (!resultsContainer) {
            // 创建新的结果容器
            resultsContainer = document.createElement('div');
            resultsContainer.className = 'deep-results-container';
            this.deepSearchResults.innerHTML = ''; // 清除之前的内容
            this.deepSearchResults.appendChild(resultsContainer);
        }

        // 格式化并显示内容
        resultsContainer.innerHTML = `
            <div class="deep-result-item">
                <div class="deep-result-content raw-content">
                    ${this.formatRawContent(content)}
                </div>
            </div>
        `;
    }

    // 添加原始内容格式化方法
    formatRawContent(content) {
        // 预处理内容
        let processedContent = content
            // 处理问题标记
            .replace(/问题：#\s*/g, '<h3>问题：</h3>')
            .replace(/问题：(?!#)/g, '<h3>问题：</h3>')
            // 处理回答标记
            .replace(/##\s*回答/g, '<h4>回答：</h4>')
            // 处理分析点标记
            .replace(/###\s*分析点/g, '<h4>分析要点：</h4>')
            // 处理引用标记
            .replace(/\[(\d+†source)\]/g, '<span class="reference-tag">[$1]</span>')
            // 处理粗体
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            // 处理换行
            .replace(/\n\n+/g, '</p><p>')
            .replace(/\n/g, '<br>');

        // 确保内容被段落标签包裹
        if (!processedContent.startsWith('<')) {
            processedContent = `<p>${processedContent}</p>`;
        }

        return processedContent;
    }

    // 添加新的显示方法
    displayIncrementalResults(formattedResults) {
        console.log('显示增量结果:', formattedResults);
        
        // 检查是否已有结果容器
        let resultsContainer = this.deepSearchResults.querySelector('.deep-results-container');
        if (!resultsContainer) {
            // 创建新的结果容器
            resultsContainer = document.createElement('div');
            resultsContainer.className = 'deep-results-container';
            this.deepSearchResults.innerHTML = ''; // 清除之前的内容
            this.deepSearchResults.appendChild(resultsContainer);
        }

        // 确保有结果要显示
        if (formattedResults && formattedResults.length > 0) {
            // 更新结果内容
            resultsContainer.innerHTML = formattedResults.map(result => `
                <div class="deep-result-item">
                    <h3>${result.title || '分析结果'}</h3>
                    <div class="deep-result-content">
                        ${result.content || ''}
                    </div>
                </div>
            `).join('');
        } else {
            resultsContainer.innerHTML = '<div class="no-results">正在等待分析结果...</div>';
        }
    }

    // 添加处理状态显示方法
    showProcessingStatus(results) {
        const hasQuestion = results.fullResponse.includes('#问题');
        const hasAnswer = results.fullResponse.includes('##回答');
        const hasAnalysis = results.fullResponse.includes('###分析点');

        const statusHtml = `
            <div class="processing-status">
                <div class="status-message">正在处理分析结果...</div>
                <div class="parse-status">
                    <div class="status-item ${hasQuestion ? 'complete' : ''}">
                        问题标记 ${this.checkMark(hasQuestion)}
                    </div>
                    <div class="status-item ${hasAnswer ? 'complete' : ''}">
                        回答标记 ${this.checkMark(hasAnswer)}
                    </div>
                    <div class="status-item ${hasAnalysis ? 'complete' : ''}">
                        分析标记 ${this.checkMark(hasAnalysis)}
                    </div>
                </div>
                <div class="progress-info">
                    已接收 ${results.fullResponse.length} 字符
                    ${results.searchResults.length > 0 ? 
                        `，${results.searchResults.length} 条搜索结果` : 
                        ''}
                </div>
            </div>
        `;

        // 仅在没有显示结果时显示状态
        if (!this.deepSearchResults.querySelector('.deep-results-container')) {
            this.deepSearchResults.innerHTML = statusHtml;
        }
    }

    // 更新深度搜索结果显示
    updateDeepSearchResults(results) {
        if (!results.formattedResults.length) {
            this.deepSearchResults.innerHTML = '<div class="no-results">正在分析中...</div>';
            return;
        }

        // 保持滚动位置
        const scrollTop = this.deepSearchResults.scrollTop;
        
        this.deepSearchResults.innerHTML = results.formattedResults.map(result => `
            <div class="deep-result-item">
                <h3>${result.title}</h3>
                <div class="deep-result-content">
                    ${result.content}
                </div>
            </div>
        `).join('');

        // 恢复滚动位置
        this.deepSearchResults.scrollTop = scrollTop;
    }

    // 添加检查完整section的方法
    hasCompleteSection(text) {
        // 检查是否包含完整的问题-回答-分析结构
        const hasQuestion = text.includes('#问题');
        const hasAnswer = text.includes('##回答');
        const hasAnalysis = text.includes('###分析点');
        
        // 检查是否有完整的内容（不只是标题）
        const questionContent = text.match(/#问题\s*([^#]+)/);
        const answerContent = text.match(/##回答\s*([^#]+)/);
        
        return hasQuestion && hasAnswer && hasAnalysis && 
               questionContent?.[1]?.trim() && 
               answerContent?.[1]?.trim();
    }

    // 添加辅助方法
    checkMark(condition) {
        return condition ? '✓' : '✗';
    }

    // 添加深度搜索错误显示方法
    showDeepSearchError(message) {
        const errorHtml = `
            <div class="deep-search-error">
                <div class="error-title">深度分析遇到问题</div>
                <div class="error-message">${message}</div>
                <div class="error-help">请尝试以下解决方案：</div>
                <ul>
                    <li>检查网络连接是否稳定</li>
                    <li>稍后重试搜索</li>
                    <li>尝试简化搜索问题</li>
                </ul>
            </div>
        `;

        // 在保持现有内容的同时添加错误信息
        const currentContent = this.deepSearchResults.innerHTML;
        if (!currentContent.includes('deep-search-error')) {
            this.deepSearchResults.innerHTML = errorHtml + currentContent;
        }
    }

    // 添加新的格式化方法
    formatListContent(content) {
        const lines = content.split('\n');
        let formattedContent = '';
        let inList = false;
        let listType = '';

        for (const line of lines) {
            if (line.match(/^\d+\.\s/)) {
                // 有序列表项
                if (!inList || listType !== 'ol') {
                    if (inList) formattedContent += `</${listType}>\n`;
                    formattedContent += '<ol>\n';
                    inList = true;
                    listType = 'ol';
                }
                formattedContent += `<li>${line.replace(/^\d+\.\s/, '')}</li>\n`;
            } else if (line.match(/^-\s/)) {
                // 无序列表项
                if (!inList || listType !== 'ul') {
                    if (inList) formattedContent += `</${listType}>\n`;
                    formattedContent += '<ul>\n';
                    inList = true;
                    listType = 'ul';
                }
                formattedContent += `<li>${line.replace(/^-\s/, '')}</li>\n`;
            } else if (line.trim()) {
                // 普通文本
                if (inList) {
                    formattedContent += `</${listType}>\n`;
                    inList = false;
                }
                formattedContent += `<p>${line}</p>\n`;
            }
        }

        if (inList) {
            formattedContent += `</${listType}>\n`;
        }

        return formattedContent;
    }

    // 修改generateMindMap方法
    async generateMindMap(content) {
        try {
            const response = await fetch(this.assistantUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    assistant_id: '664e0cade018d633146de0d2',
                    model: "glm-4-assistant",
                    stream: true,  // 使用流式输出
                    messages: [{
                        role: "user",
                        content: [{
                            type: "text",
                            text: `请根据以下内容生成一个思维导图：\n\n${content}`
                        }]
                    }]
                })
            });

            if (!response.ok) {
                throw new Error(`思维导图生成失败: ${response.status}`);
            }

            // 处理流式响应
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let mindMapContent = '';

            while (true) {
                const {done, value} = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, {stream: true});
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6).trim());
                            if (data.choices?.[0]?.delta?.content) {
                                mindMapContent += data.choices[0].delta.content;
                                // 实时更新思维导图显示
                                this.displayMindMap(mindMapContent);
                            }
                        } catch (e) {
                            console.warn('解析思维导图数据失败:', e);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('生成思维导图失败:', error);
        }
    }

    // 修改displayMindMap方法
    displayMindMap(mindMapContent) {
        try {
            // 提取图片URL
            const imageMatch = mindMapContent.match(/!\[.*?\]\((https:\/\/sfile\.chatglm\.cn\/markmap\/.*?\.png)\)/);
            if (!imageMatch) {
                console.warn('未找到思维导图图片URL');
                return;
            }

            const imageUrl = imageMatch[1];

            // 获取或创建思维导图容器
            let mindMapContainer = this.deepSearchResults.querySelector('.mind-map-container');
            if (!mindMapContainer) {
                mindMapContainer = document.createElement('div');
                mindMapContainer.className = 'mind-map-container';
                this.deepSearchResults.appendChild(mindMapContainer);
            }

            // 显示思维导图图片
            mindMapContainer.innerHTML = `
                <h3>思维导图</h3>
                <div class="mind-map-content">
                    <img src="${imageUrl}" alt="思维导图" class="mind-map-image">
                </div>
            `;
        } catch (error) {
            console.error('显示思维导图失败:', error);
        }
    }
}

// 初始化搜索引擎
document.addEventListener('DOMContentLoaded', () => {
    new AISearchEngine();
}); 