document.addEventListener('DOMContentLoaded', () => {
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    const previewArea = document.getElementById('previewArea');
    const ocrPreviewArea = document.getElementById('ocrPreviewArea');
    const ocrControls = document.getElementById('ocrControls');
    const startOcrBtn = document.getElementById('startOcrBtn');
    const autoSplit = document.getElementById('autoSplit');

    let currentImage = null;
    let imageWidth = 0;
    let imageHeight = 0;

    // 常用符号+字母数字白名单
    const CHAR_WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{};:\'",.<>/?\\|~`';
    const PSM_LIST = [6, 7, 10];
    const CHAR_CANVAS_SIZE = 64;

    // 多阈值列表
    const BIN_THRESHOLDS = [150, 180, 210];
    const DIGIT_WHITELIST = '0123456789';
    const SYMBOL_WHITELIST = '!@#$%^&*()-_=+[]{};:\'\",.<>/?\\|~`';

    // 处理拖拽上传
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        const files = e.dataTransfer.files;
        handleFiles(files);
    });

    // 处理文件选择
    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
    });

    // 处理文件上传和预览
    function handleFiles(files) {
        Array.from(files).forEach(file => {
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    // 创建临时图片来获取实际尺寸
                    const img = new Image();
                    img.onload = () => {
                        imageWidth = img.width;
                        imageHeight = img.height;
                        currentImage = e.target.result;
                        createPreviewItem(e.target.result);
                        ocrControls.style.display = 'flex';
                        ocrPreviewArea.innerHTML = '';
                    };
                    img.src = e.target.result;
                };
                reader.readAsDataURL(file);
            }
        });
    }

    // 创建预览项
    function createPreviewItem(imageUrl) {
        const previewItem = document.createElement('div');
        previewItem.className = 'preview-item';

        const img = document.createElement('img');
        img.src = imageUrl;
        img.alt = '预览图片';

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.innerHTML = '×';
        deleteBtn.onclick = () => {
            previewItem.remove();
            ocrControls.style.display = 'none';
            ocrPreviewArea.innerHTML = '';
            currentImage = null;
        };

        previewItem.appendChild(img);
        previewItem.appendChild(deleteBtn);
        previewArea.appendChild(previewItem);
    }

    // 开始OCR识别
    startOcrBtn.addEventListener('click', () => {
        if (currentImage) {
            performOCR(currentImage);
        }
    });

    // 执行OCR识别
    async function performOCR(imageUrl) {
        try {
            // 显示加载状态
            ocrPreviewArea.innerHTML = '<div class="loading">正在识别中...</div>';
            
            // 显示OCR进度条
            const ocrProgressWrapper = document.getElementById('ocrProgressWrapper');
            const ocrProgressBar = document.getElementById('ocrProgressBar');
            const ocrProgressText = document.getElementById('ocrProgressText');
            ocrProgressWrapper.style.display = 'inline-flex';
            
            // 使用Tesseract.js进行OCR识别
            const result = await Tesseract.recognize(
                imageUrl,
                'eng',
                {
                    logger: m => {
                        if (m.status === 'recognizing text') {
                            const progress = Math.round(m.progress * 100);
                            ocrProgressBar.style.width = `${progress}%`;
                            ocrProgressText.textContent = `${progress}%`;
                            ocrPreviewArea.innerHTML = `<div class="loading">识别进度: ${progress}%</div>`;
                        }
                    }
                }
            );

            // 清除加载状态
            ocrPreviewArea.innerHTML = '';
            ocrProgressWrapper.style.display = 'none';
            
            // 处理识别结果
            if (autoSplit.checked) {
                // 整行识别+分割校正
                const lines = result.data.lines;
                for (const line of lines) {
                    const text = line.text.replace(/\s/g, '');
                    const bbox = line.bbox;
                    // 分割行内字符块
                    await splitLineByConnectedComponents(text, bbox, imageUrl);
                }
            } else {
                // 使用单词级别的识别结果
                const words = result.data.words;
                words.forEach(word => {
                    createOCRItem(word.text, word.bbox);
                });
            }
            
            // OCR识别完成后，提前显示字体预览区域
            setupEmptyPreview();
            
            // 尝试生成一个初始预览字体
            generatePreviewFont();
            
        } catch (error) {
            console.error('OCR识别错误:', error);
            ocrPreviewArea.innerHTML = '<div class="error">识别失败，请重试</div>';
        }
    }

    // 整行分割+识别校正
    async function splitLineByConnectedComponents(text, bbox, imageUrl) {
        return new Promise((resolve) => {
            const cropWidth = bbox.x1 - bbox.x0;
            const cropHeight = bbox.y1 - bbox.y0;
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = cropWidth;
            tempCanvas.height = cropHeight;
            const ctx = tempCanvas.getContext('2d', { willReadFrequently: true });
            const img = new Image();
            img.onload = async () => {
                ctx.drawImage(img, bbox.x0, bbox.y0, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
                // 多阈值分割
                let bestCharResults = [];
                for (const threshold of BIN_THRESHOLDS) {
                    const imageData = ctx.getImageData(0, 0, cropWidth, cropHeight);
                    const binary = binarizeImageData(imageData, threshold);
                    const components = findConnectedComponents(binary, cropWidth, cropHeight);
                    const minArea = (cropWidth * cropHeight) * 0.01;
                    const charComponents = components.filter(c => c.area > minArea);
                    charComponents.sort((a, b) => a.x0 - b.x0);
                    // 只保留最大数量的分割结果
                    if (charComponents.length > bestCharResults.length) {
                        bestCharResults = charComponents;
                    }
                }
                
                // 按顺序分配字符，自动识别每个字符块
                for (let i = 0; i < bestCharResults.length; i++) {
                    const comp = bestCharResults[i];
                    const charBbox = {
                        x0: bbox.x0 + comp.x0,
                        y0: bbox.y0 + comp.y0,
                        x1: bbox.x0 + comp.x1,
                        y1: bbox.y0 + comp.y1
                    };
                    // 高分辨率标准化canvas
                    const charWidth = charBbox.x1 - charBbox.x0;
                    const charHeight = charBbox.y1 - charBbox.y0;
                    const charCanvas = document.createElement('canvas');
                    charCanvas.width = CHAR_CANVAS_SIZE;
                    charCanvas.height = CHAR_CANVAS_SIZE;
                    const charCtx = charCanvas.getContext('2d', { willReadFrequently: true });
                    charCtx.fillStyle = 'white';
                    charCtx.fillRect(0, 0, CHAR_CANVAS_SIZE, CHAR_CANVAS_SIZE);
                    const scale = Math.min(CHAR_CANVAS_SIZE / charWidth, CHAR_CANVAS_SIZE / charHeight) * 0.9;
                    const sw = charWidth * scale;
                    const sh = charHeight * scale;
                    const sx = (CHAR_CANVAS_SIZE - sw) / 2;
                    const sy = (CHAR_CANVAS_SIZE - sh) / 2;
                    charCtx.drawImage(img, comp.x0 + bbox.x0, comp.y0 + bbox.y0, charWidth, charHeight, sx, sy, sw, sh);
                    // 多次识别投票
                    let results = [];
                    for (const psm of PSM_LIST) {
                        try {
                            const charResult = await Tesseract.recognize(charCanvas, 'eng', {
                                tessedit_char_whitelist: CHAR_WHITELIST,
                                tessedit_pageseg_mode: psm
                            });
                            let chars = charResult.data.text.replace(/\s/g, '').split('').filter(c => CHAR_WHITELIST.includes(c));
                            if (chars.length > 0) results.push(...chars);
                        } catch (e) {}
                    }
                    // 取众数或第一个
                    let charText = '';
                    if (results.length > 0) {
                        charText = results.sort((a,b) => results.filter(v=>v===a).length - results.filter(v=>v===b).length).pop();
                    }
                    // 优先用整行识别的字符兜底
                    if ((!charText || charText === '?') && i < text.length) charText = text[i];
                    // 只有主识别和整行识别都失败时才用数字/符号白名单兜底
                    if ((!charText || charText === '?')) {
                        // 数字兜底
                        try {
                            const digitResult = await Tesseract.recognize(charCanvas, 'eng', {
                                tessedit_char_whitelist: DIGIT_WHITELIST,
                                tessedit_pageseg_mode: 10
                            });
                            let digitChar = digitResult.data.text.replace(/\s/g, '').split('').filter(c => DIGIT_WHITELIST.includes(c))[0];
                            if (digitChar) charText = digitChar;
                        } catch (e) {}
                        // 符号兜底
                        if ((!charText || charText === '?')) {
                            try {
                                const symbolResult = await Tesseract.recognize(charCanvas, 'eng', {
                                    tessedit_char_whitelist: SYMBOL_WHITELIST,
                                    tessedit_pageseg_mode: 10
                                });
                                let symbolChar = symbolResult.data.text.replace(/\s/g, '').split('').filter(c => SYMBOL_WHITELIST.includes(c))[0];
                                if (symbolChar) charText = symbolChar;
                            } catch (e) {}
                        }
                    }
                    createOCRItem(charText, charBbox);
                }
                resolve();
            };
            img.src = imageUrl;
        });
    }

    // 二值化
    function binarizeImageData(imageData, threshold) {
        const { data, width, height } = imageData;
        const binary = new Uint8Array(width * height);
        for (let i = 0; i < width * height; i++) {
            const r = data[i * 4];
            const g = data[i * 4 + 1];
            const b = data[i * 4 + 2];
            const gray = 0.299 * r + 0.587 * g + 0.114 * b;
            binary[i] = gray < threshold ? 1 : 0;
        }
        return binary;
    }

    // 连通域分析（4邻域）
    function findConnectedComponents(binary, width, height) {
        const visited = new Uint8Array(width * height);
        const components = [];
        const dx = [1, 0, -1, 0];
        const dy = [0, 1, 0, -1];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (binary[idx] && !visited[idx]) {
                    // 新连通域
                    let minX = x, maxX = x, minY = y, maxY = y, area = 0;
                    const stack = [[x, y]];
                    visited[idx] = 1;
                    while (stack.length) {
                        const [cx, cy] = stack.pop();
                        const cidx = cy * width + cx;
                        area++;
                        minX = Math.min(minX, cx);
                        maxX = Math.max(maxX, cx);
                        minY = Math.min(minY, cy);
                        maxY = Math.max(maxY, cy);
                        for (let d = 0; d < 4; d++) {
                            const nx = cx + dx[d];
                            const ny = cy + dy[d];
                            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                                const nidx = ny * width + nx;
                                if (binary[nidx] && !visited[nidx]) {
                                    visited[nidx] = 1;
                                    stack.push([nx, ny]);
                                }
                            }
                        }
                    }
                    components.push({ x0: minX, y0: minY, x1: maxX + 1, y1: maxY + 1, area });
                }
            }
        }
        return components;
    }

    // 创建OCR结果项
    function createOCRItem(char, bbox) {
        const ocrItem = document.createElement('div');
        ocrItem.className = 'ocr-item';

        // 添加可拖拽属性
        ocrItem.setAttribute('draggable', 'true');
        
        // 标记元素为可拖拽的字符项
        ocrItem.dataset.type = 'char-item';
        
        // 存储原始位置信息
        ocrItem.dataset.originalX = bbox.x0;
        ocrItem.dataset.originalY = bbox.y0;
        ocrItem.dataset.originalWidth = bbox.x1 - bbox.x0;
        ocrItem.dataset.originalHeight = bbox.y1 - bbox.y0;
        
        // 为拖拽操作添加事件
        ocrItem.addEventListener('dragstart', handleDragStart);
        ocrItem.addEventListener('dragover', handleDragOver);
        ocrItem.addEventListener('drop', handleDrop);
        ocrItem.addEventListener('dragenter', handleDragEnter);
        ocrItem.addEventListener('dragleave', handleDragLeave);

        // 创建字符图片容器
        const charImageContainer = document.createElement('div');
        charImageContainer.className = 'char-image-container';
        
        // 创建删除图标 - 垃圾桶造型
        const deleteIcon = document.createElement('div');
        deleteIcon.className = 'char-delete-icon';
        deleteIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M9,3V4H4V6H5V19A2,2 0 0,0 7,21H17A2,2 0 0,0 19,19V6H20V4H15V3H9M7,6H17V19H7V6M9,8V17H11V8H9M13,8V17H15V8H13Z"/></svg>';
        deleteIcon.title = "删除字符";
        deleteIcon.style.display = 'none'; // 默认隐藏
        
        // 添加删除事件
        deleteIcon.addEventListener('click', function(e) {
            e.stopPropagation();
            if (confirm('确定要删除这个字符吗？')) {
                ocrItem.remove();
                // 字符删除后重新生成预览字体
                generatePreviewFont();
            }
        });

        // 创建Canvas元素
        const canvas = document.createElement('canvas');
        canvas.width = 300;  // 增加分辨率到300
        canvas.height = 300; // 增加分辨率到300
        canvas.style.width = '100px';  // 保持显示尺寸不变
        canvas.style.height = '100px'; // 保持显示尺寸不变
        const ctx = canvas.getContext('2d', { willReadFrequently: true });  // 添加 willReadFrequently 属性

        // 加载原始图片
        const img = new Image();
        img.onload = () => {
            // 计算裁剪区域
            const cropX = bbox.x0;
            const cropY = bbox.y0;
            const cropWidth = bbox.x1 - bbox.x0;
            const cropHeight = bbox.y1 - bbox.y0;

            // 计算缩放比例，使字符填充90%的Canvas区域
            const scale = Math.min(
                270 / cropWidth,  // 填充90%
                270 / cropHeight
            );

            // 计算居中位置
            const scaledWidth = cropWidth * scale;
            const scaledHeight = cropHeight * scale;
            const x = (300 - scaledWidth) / 2;
            const y = (300 - scaledHeight) / 2;

            // 清除画布 - 使用白色背景
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // 启用高质量图像渲染
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            
            // 增强对比度和锐化
            ctx.filter = 'contrast(1.6) brightness(1.05)';

            // 绘制裁剪后的图片
            ctx.drawImage(
                img,
                cropX, cropY, cropWidth, cropHeight,  // 源图像裁剪区域
                x, y, scaledWidth, scaledHeight       // 目标区域
            );

            // 记录部件在Canvas中的实际位置和缩放信息
            canvas.dataset.scaleX = scale;
            canvas.dataset.scaleY = scale;
            canvas.dataset.offsetX = x;
            canvas.dataset.offsetY = y;

            // 重置滤镜和平滑设置
            ctx.filter = 'none';
            ctx.imageSmoothingEnabled = false;
            
            // 应用增强处理以提高清晰度
            enhanceCharacterImage(canvas);
        };
        img.src = currentImage;

        charImageContainer.appendChild(canvas);
        charImageContainer.appendChild(deleteIcon);
        ocrItem.appendChild(charImageContainer);
        
        // 添加鼠标悬停事件，显示/隐藏删除图标
        ocrItem.addEventListener('mouseenter', function() {
            deleteIcon.style.display = 'flex';
        });
        
        ocrItem.addEventListener('mouseleave', function() {
            deleteIcon.style.display = 'none';
        });

        // 添加手动纠错输入框
        const correctionDiv = document.createElement('div');
        correctionDiv.className = 'correction';
        const correctionInput = document.createElement('input');
        correctionInput.type = 'text';
        correctionInput.value = char;
        correctionInput.maxLength = 1;
        correctionDiv.appendChild(correctionInput);

        ocrItem.appendChild(correctionDiv);
        ocrPreviewArea.appendChild(ocrItem);
    }

    // 拖拽相关功能 ===============
    let draggedItem = null;
    
    // 处理拖拽开始
    function handleDragStart(e) {
        draggedItem = this;
        this.classList.add('dragging');
        
        // 设置拖拽数据
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', this.dataset.type);
        
        // 如果是组合容器，则设置透明度
        if (this.classList.contains('char-composer')) {
            this.style.opacity = '0.6';
        }
    }
    
    // 允许放置
    function handleDragOver(e) {
        if (e.preventDefault) {
            e.preventDefault(); // 允许放置
        }
        
        e.dataTransfer.dropEffect = 'move';
        return false;
    }
    
    // 拖拽进入
    function handleDragEnter(e) {
        this.classList.add('drag-over');
    }
    
    // 拖拽离开
    function handleDragLeave(e) {
        this.classList.remove('drag-over');
    }
    
    // 处理放置
    function handleDrop(e) {
        e.stopPropagation();
        
        // 移除样式
        this.classList.remove('drag-over');
        
        // 如果放回自己，不处理
        if (draggedItem === this) {
            draggedItem.classList.remove('dragging');
            return false;
        }
        
        // 确定目标元素类型
        const targetType = this.dataset.type;
        const draggedType = draggedItem.dataset.type;
        
        // 组合容器 - 创建或使用现有的
        let composerContainer;
        
        // 如果拖拽到现有组合容器
        if (this.classList.contains('char-composer')) {
            composerContainer = this;
            handleDropIntoComposer(draggedItem, composerContainer);
        } 
        // 如果是字符项拖拽到另一个字符项 - 创建新组合容器
        else if (targetType === 'char-item' && draggedType === 'char-item') {
            // 获取原始位置信息
            const targetOrigX = parseFloat(this.dataset.originalX);
            const targetOrigY = parseFloat(this.dataset.originalY);
            const targetOrigWidth = parseFloat(this.dataset.originalWidth);
            const targetOrigHeight = parseFloat(this.dataset.originalHeight);
            
            const draggedOrigX = parseFloat(draggedItem.dataset.originalX);
            const draggedOrigY = parseFloat(draggedItem.dataset.originalY);
            const draggedOrigWidth = parseFloat(draggedItem.dataset.originalWidth);
            const draggedOrigHeight = parseFloat(draggedItem.dataset.originalHeight);
            
            // 获取Canvas元素
            const targetCanvas = this.querySelector('canvas');
            const draggedCanvas = draggedItem.querySelector('canvas');
            
            // 创建组合容器
            composerContainer = createComposerContainer();
            
            // 初始化部件信息数组
            const partsInfo = [
                {
                    origX: targetOrigX,
                    origY: targetOrigY,
                    origWidth: targetOrigWidth,
                    origHeight: targetOrigHeight
                },
                {
                    origX: draggedOrigX,
                    origY: draggedOrigY,
                    origWidth: draggedOrigWidth,
                    origHeight: draggedOrigHeight
                }
            ];
            
            // 保存部件信息到容器中
            composerContainer.dataset.partsInfo = JSON.stringify(partsInfo);
            
            // 使用原始图片进行合成
            reconstructMultiplePartsFromOriginal(composerContainer, partsInfo);
            
            // 插入新的组合容器到目标元素后面
            this.parentNode.insertBefore(composerContainer, this.nextSibling);
            
            // 删除原始元素
            this.remove();
            draggedItem.remove();
            
            // 设置输入值为组合字符
            const composeInput = composerContainer.querySelector('input');
            const draggedInput = draggedItem.querySelector('input').value;
            const targetInput = this.querySelector('input').value;
            
            // 根据字符自动选择合适的组合顺序
            if (targetInput === '?' || targetInput === '!' || targetInput === 'i' || targetInput === 'j') {
                composeInput.value = targetInput; // 保留特殊字符的原始值
            } else if (draggedInput === '?' || draggedInput === '!' || draggedInput === 'i' || draggedInput === 'j') {
                composeInput.value = draggedInput; // 如果拖拽的是特殊字符，也保留
            } else {
                composeInput.value = targetInput + draggedInput;
            }
            
            // 生成预览字体
            generatePreviewFont();
        }
        
        // 重置拖拽状态
        draggedItem.classList.remove('dragging');
        draggedItem = null;
        
        return false;
    }
    
    // 使用原始图片位置信息重建完整字符
    function reconstructFromOriginalImage(composerContainer, targetPart, draggedPart) {
        // 创建合成Canvas
        const compositeCanvas = document.createElement('canvas');
        compositeCanvas.width = 80;
        compositeCanvas.height = 80;
        compositeCanvas.className = 'composite-canvas';
        const ctx = compositeCanvas.getContext('2d');
        
        // 绘制白色背景
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, 80, 80);
        
        // 创建临时图像以重建完整字符
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = imageWidth;  // 使用全局变量存储的原始图片宽度
        tempCanvas.height = imageHeight; // 使用全局变量存储的原始图片高度
        const tempCtx = tempCanvas.getContext('2d');
        
        // 绘制白色背景
        tempCtx.fillStyle = 'white';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        
        // 加载并重建原始图片部分
        const img = new Image();
        img.onload = () => {
            // 计算包含所有部件的边界框
            const minX = Math.min(targetPart.origX, draggedPart.origX);
            const minY = Math.min(targetPart.origY, draggedPart.origY);
            const maxX = Math.max(targetPart.origX + targetPart.origWidth, 
                                draggedPart.origX + draggedPart.origWidth);
            const maxY = Math.max(targetPart.origY + targetPart.origHeight,
                                draggedPart.origY + draggedPart.origHeight);
            
            // 计算完整字符的宽高
            const fullWidth = maxX - minX;
            const fullHeight = maxY - minY;
            
            // 将原始图片绘制到临时Canvas中
            tempCtx.drawImage(img, 0, 0, imageWidth, imageHeight);
            
            // 从临时Canvas中裁剪包含所有部件的区域
            const fullCharImage = tempCtx.getImageData(minX, minY, fullWidth, fullHeight);
            
            // 计算在最终Canvas中的缩放和位置
            const scale = Math.min(
                70 / fullWidth,
                70 / fullHeight
            );
            
            const displayWidth = fullWidth * scale;
            const displayHeight = fullHeight * scale;
            const displayX = (80 - displayWidth) / 2;
            const displayY = (80 - displayHeight) / 2;
            
            // 创建另一个临时Canvas用于缩放
            const scaleCanvas = document.createElement('canvas');
            scaleCanvas.width = fullWidth;
            scaleCanvas.height = fullHeight;
            const scaleCtx = scaleCanvas.getContext('2d');
            
            // 放置完整字符图像
            const imgData = new ImageData(fullCharImage.data, fullWidth, fullHeight);
            scaleCtx.putImageData(imgData, 0, 0);
            
            // 绘制到最终的合成Canvas上
            ctx.drawImage(scaleCanvas, 0, 0, fullWidth, fullHeight, 
                        displayX, displayY, displayWidth, displayHeight);
            
            // 添加到组合容器
            const partsContainer = composerContainer.querySelector('.composer-parts-container');
            partsContainer.appendChild(compositeCanvas);
        };
        img.src = currentImage;
        
        return compositeCanvas;
    }
    
    // 处理拖拽到组合容器
    function handleDropIntoComposer(draggedItem, composerContainer) {
        // 如果拖拽的是普通字符项
        if (draggedItem.dataset.type === 'char-item') {
            // 获取原始位置信息
            const draggedOrigX = parseFloat(draggedItem.dataset.originalX);
            const draggedOrigY = parseFloat(draggedItem.dataset.originalY);
            const draggedOrigWidth = parseFloat(draggedItem.dataset.originalWidth);
            const draggedOrigHeight = parseFloat(draggedItem.dataset.originalHeight);
            
            // 获取合成Canvas
            const compositeCanvas = composerContainer.querySelector('.composite-canvas');
            
            // 获取已存在部件的原始位置信息
            let existingPartsInfo = [];
            if (composerContainer.dataset.partsInfo) {
                try {
                    existingPartsInfo = JSON.parse(composerContainer.dataset.partsInfo);
                } catch (e) {
                    console.error('解析现有部件信息出错:', e);
                    existingPartsInfo = [];
                }
            }
            
            // 添加新部件位置信息
            existingPartsInfo.push({
                origX: draggedOrigX,
                origY: draggedOrigY,
                origWidth: draggedOrigWidth,
                origHeight: draggedOrigHeight
            });
            
            // 重新在原始图片上合成所有部件
            reconstructMultiplePartsFromOriginal(composerContainer, existingPartsInfo);
            
            // 更新组合后的输入值
            const composeInput = composerContainer.querySelector('input');
            const draggedInput = draggedItem.querySelector('input').value;
            
            // 如果新拖入的是特殊字符，可能需要保留特殊字符值
            if (draggedInput === '?' || draggedInput === '!' || draggedInput === 'i' || draggedInput === 'j') {
                if (!composeInput.value.includes(draggedInput)) {
                    composeInput.value = draggedInput;
                }
            } else {
                // 否则添加到现有值中
                if (!composeInput.value.includes(draggedInput)) {
                    composeInput.value += draggedInput;
                }
            }
            
            // 保存更新后的部件信息
            composerContainer.dataset.partsInfo = JSON.stringify(existingPartsInfo);
            
            // 删除原始元素
            draggedItem.remove();
        }
        
        // 重置样式
        composerContainer.style.opacity = '1';
        
        // 生成预览字体
        generatePreviewFont();
    }
    
    // 从原始图片重建多个部件合成的图像
    function reconstructMultiplePartsFromOriginal(composerContainer, partsInfo) {
        if (!partsInfo || partsInfo.length === 0) return;
        
        // 清除现有内容
        const partsContainer = composerContainer.querySelector('.composer-parts-container');
        partsContainer.innerHTML = '';
        
        // 创建合成Canvas
        const compositeCanvas = document.createElement('canvas');
        compositeCanvas.width = 80;  // 固定尺寸与普通字符预览一致
        compositeCanvas.height = 80; // 固定尺寸与普通字符预览一致
        compositeCanvas.className = 'composite-canvas';
        partsContainer.appendChild(compositeCanvas);
        
        const ctx = compositeCanvas.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, 80, 80);
        
        // 找出所有部件包围的最小区域
        let minX = Number.MAX_VALUE, minY = Number.MAX_VALUE;
        let maxX = 0, maxY = 0;
        
        partsInfo.forEach(part => {
            minX = Math.min(minX, part.origX);
            minY = Math.min(minY, part.origY);
            maxX = Math.max(maxX, part.origX + part.origWidth);
            maxY = Math.max(maxY, part.origY + part.origHeight);
        });
        
        // 计算完整字符的宽高
        const fullWidth = maxX - minX;
        const fullHeight = maxY - minY;
        
        // 创建临时Canvas
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = imageWidth;
        tempCanvas.height = imageHeight;
        const tempCtx = tempCanvas.getContext('2d');
        
        // 加载原始图片
        const img = new Image();
        img.onload = () => {
            // 绘制原始图片
            tempCtx.drawImage(img, 0, 0, imageWidth, imageHeight);
            
            // 从临时Canvas裁剪完整区域
            try {
                const fullCharImage = tempCtx.getImageData(minX, minY, fullWidth, fullHeight);
                
                // 计算缩放比例，保持70x70的显示区域
                const scale = Math.min(70 / fullWidth, 70 / fullHeight);
                const displayWidth = fullWidth * scale;
                const displayHeight = fullHeight * scale;
                const displayX = (80 - displayWidth) / 2; // 居中显示
                const displayY = (80 - displayHeight) / 2; // 居中显示
                
                // 创建另一个临时Canvas用于缩放
                const scaleCanvas = document.createElement('canvas');
                scaleCanvas.width = fullWidth;
                scaleCanvas.height = fullHeight;
                const scaleCtx = scaleCanvas.getContext('2d');
                
                // 放置完整字符图像
                const imgData = new ImageData(fullCharImage.data, fullWidth, fullHeight);
                scaleCtx.putImageData(imgData, 0, 0);
                
                // 绘制到最终的合成Canvas
                ctx.drawImage(scaleCanvas, 0, 0, fullWidth, fullHeight, 
                            displayX, displayY, displayWidth, displayHeight);
                
                console.log(`成功合成了${partsInfo.length}个部件`);
                
            } catch (error) {
                console.error('Error reconstructing from original image:', error);
                // 图像处理失败时的备用方案
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, 80, 80);
                partsInfo.forEach(part => {
                    ctx.fillStyle = 'black';
                    // 简单绘制矩形代表每个部件位置
                    const relX = (part.origX - minX) / fullWidth * 70 + 5;
                    const relY = (part.origY - minY) / fullHeight * 70 + 5;
                    const relWidth = part.origWidth / fullWidth * 70;
                    const relHeight = part.origHeight / fullHeight * 70;
                    ctx.fillRect(relX, relY, relWidth, relHeight);
                });
            }
        };
        img.src = currentImage;
    }
    
    // 创建组合容器
    function createComposerContainer() {
        const container = document.createElement('div');
        container.className = 'ocr-item char-composer';
        container.setAttribute('draggable', 'true');
        container.dataset.type = 'composer';
        
        // 添加拖拽事件
        container.addEventListener('dragstart', handleDragStart);
        container.addEventListener('dragover', handleDragOver);
        container.addEventListener('drop', handleDrop);
        container.addEventListener('dragenter', handleDragEnter);
        container.addEventListener('dragleave', handleDragLeave);
        
        // 创建画布容器 - 统一使用char-image-container类保持样式一致
        const canvasContainer = document.createElement('div');
        canvasContainer.className = 'char-image-container composer-canvas-container';
        
        // 创建组件画布容器
        const partsContainer = document.createElement('div');
        partsContainer.className = 'composer-parts-container';
        canvasContainer.appendChild(partsContainer);
        
        // 添加删除图标
        const deleteIcon = document.createElement('div');
        deleteIcon.className = 'char-delete-icon';
        deleteIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M9,3V4H4V6H5V19A2,2 0 0,0 7,21H17A2,2 0 0,0 19,19V6H20V4H15V3H9M7,6H17V19H7V6M9,8V17H11V8H9M13,8V17H15V8H13Z"/></svg>';
        deleteIcon.title = "删除组合字符";
        deleteIcon.style.display = 'none';
        
        // 添加删除事件
        deleteIcon.addEventListener('click', function(e) {
            e.stopPropagation();
            if (confirm('确定要删除这个组合字符吗？')) {
                container.remove();
                generatePreviewFont();
            }
        });
        
        canvasContainer.appendChild(deleteIcon);
        container.appendChild(canvasContainer);
        
        // 添加鼠标悬停事件
        container.addEventListener('mouseenter', function() {
            deleteIcon.style.display = 'flex';
        });
        
        container.addEventListener('mouseleave', function() {
            deleteIcon.style.display = 'none';
        });
        
        // 添加输入框用于组合后的字符
        const correctionDiv = document.createElement('div');
        correctionDiv.className = 'correction';
        const correctionInput = document.createElement('input');
        correctionInput.type = 'text';
        correctionInput.value = '';
        correctionInput.maxLength = 2; // 允许最多2个字符
        correctionDiv.appendChild(correctionInput);
        
        container.appendChild(correctionDiv);
        
        return container;
    }
    
    // 添加组合字符提示按钮
    function addComposeModeControls() {
        const ocrResults = document.getElementById('ocrResults');
        
        // 检查是否已经添加
        if (document.getElementById('composeHintBtn')) {
            return;
        }
        
        // 创建提示按钮
        const hintBtn = document.createElement('button');
        hintBtn.id = 'composeHintBtn';
        hintBtn.className = 'btn secondary compose-hint-btn';
        hintBtn.innerHTML = '提示: 可拖拽不完整字形组合成完整字符 <span class="hint-icon">?</span>';
        
        // 添加点击事件展示详细说明
        hintBtn.addEventListener('click', function() {
            alert('字形组合使用说明:\n\n1. 将不完整的字符部件直接拖拽到另一个不完整字符部件上\n2. 系统会根据原始图片中的位置关系自动重建完整字符\n3. 您可以继续拖拽更多部件到同一组合字符中，系统会自动合并\n4. 拼合后将精确还原上传图片中的字符原始样式\n5. 系统会智能识别问号等特殊字符并保留原始字符值\n6. 组合的字符将作为一个整体在生成字体时使用');
        });
        
        // 插入到结果区域顶部
        const titleElement = ocrResults.querySelector('.card-title');
        if (titleElement && titleElement.nextSibling) {
            ocrResults.insertBefore(hintBtn, titleElement.nextSibling.nextSibling);
        } else {
            ocrResults.appendChild(hintBtn);
        }
    }

    // 获取当前字体设置
    function getFontSettings() {
        return {
            fontSize: parseInt(document.getElementById('fontSizeSlider')?.value || 72),
            fontColor: getCurrentFontColor(),
            bgColor: getCurrentBgColor(),
            autoInvertBg: document.getElementById('autoInvertBg')?.checked ?? true
        };
    }
    
    // 字体预览功能
    function showFontPreview(font, fontName) {
        // 显示预览区域
        const previewSection = document.getElementById('fontPreviewSection');
        if (!previewSection) return;
        
        previewSection.style.display = 'block';
        
        // 创建并加载字体
        const fontBlob = new Blob([font.toArrayBuffer()], { type: 'font/ttf' });
        const fontUrl = URL.createObjectURL(fontBlob);
        
        // 创建@font-face规则
        const fontFace = new FontFace('PreviewCustomFont', `url(${fontUrl})`);
        
        // 加载字体
        fontFace.load().then(() => {
            // 将字体添加到文档中
            document.fonts.add(fontFace);
            
            // 应用字体到预览元素
            applyCustomFontToPreview();
            
            // 应用当前的字体设置
            applyCurrentFontSettings();
        }).catch(err => {
            console.error('字体预览加载失败:', err);
        });
    }
    
    // 应用当前字体设置
    function applyCurrentFontSettings() {
        const settings = getFontSettings();
        const previewEls = document.querySelectorAll('.custom-font-preview');
        
        previewEls.forEach(el => {
            el.style.fontSize = `${settings.fontSize}px`;
            el.style.color = settings.fontColor;
            
            // 应用背景色
            if (settings.autoInvertBg) {
                // 自动反色背景
                const bgColor = getInvertColor(settings.fontColor);
                el.parentElement.style.backgroundColor = bgColor;
            } else {
                // 使用自定义背景色
                el.parentElement.style.backgroundColor = settings.bgColor;
            }
        });
    }
    
    // 应用自定义字体到预览元素
    function applyCustomFontToPreview() {
        const previewDisplay = document.getElementById('previewDisplay');
        if (previewDisplay) {
            previewDisplay.classList.add('custom-font-preview');
        }
    }

    // 设置OCR完成后的空预览区域
    function setupEmptyPreview() {
        const previewSection = document.getElementById('fontPreviewSection');
        if (!previewSection) return;
        
        previewSection.style.display = 'block';
        
        // 设置文本输入框事件
        const previewTextInput = document.getElementById('previewText');
        const previewDisplay = document.getElementById('previewDisplay');
        
        if (previewTextInput && previewDisplay) {
            previewTextInput.addEventListener('input', function() {
                previewDisplay.textContent = this.value || 'AaBbCc123!@#';
            });
        }
        
        // 设置字体大小滑块事件
        setupFontAdjustmentSliders();
        
        // 添加参数变更事件监听，实时更新预览
        const sliders = document.querySelectorAll('input[type="range"]');
        sliders.forEach(slider => {
            slider.addEventListener('change', function() {
                // 当滑块值确认改变时，重新生成预览字体
                generatePreviewFont();
            });
        });
    }
    
    // 设置所有字体调整滑块的事件处理
    function setupFontAdjustmentSliders() {
        // 字体大小调整
        const fontSizeSlider = document.getElementById('fontSizeSlider');
        const fontSizeValue = document.getElementById('fontSizeValue');
        
        if (fontSizeSlider && fontSizeValue) {
            fontSizeSlider.addEventListener('input', function() {
                const size = this.value;
                fontSizeValue.textContent = `${size}px`;
                
                const previewEls = document.querySelectorAll('.custom-font-preview');
                previewEls.forEach(el => {
                    el.style.fontSize = `${size}px`;
                });
            });
        }
        
        // 字体色盘选择器
        const fontColorPicker = document.getElementById('fontColorPicker');
        if (fontColorPicker) {
            fontColorPicker.addEventListener('input', function() {
                const color = this.value;
                
                // 更新输入框值
                const customColorInput = document.getElementById('customColorInput');
                if (customColorInput) customColorInput.value = color;
                
                // 应用颜色
                applyCurrentFontSettings();
            });
        }
        
        // 背景色盘选择器
        const bgColorPicker = document.getElementById('bgColorPicker');
        if (bgColorPicker) {
            bgColorPicker.addEventListener('input', function() {
                const color = this.value;
                
                // 更新输入框值
                const customBgColorInput = document.getElementById('customBgColorInput');
                if (customBgColorInput) customBgColorInput.value = color;
                
                // 禁用自动反色
                const autoInvertBg = document.getElementById('autoInvertBg');
                if (autoInvertBg) autoInvertBg.checked = false;
                
                // 应用颜色
                applyCurrentFontSettings();
            });
        }
        
        // 自定义字体颜色输入框
        const customColorInput = document.getElementById('customColorInput');
        if (customColorInput) {
            customColorInput.addEventListener('input', function() {
                let color = this.value;
                if (!color.startsWith('#') && color.length > 0) {
                    color = '#' + color;
                }
                
                if (/^#[0-9A-Fa-f]{6}$/.test(color)) {
                    // 更新色盘值
                    const fontColorPicker = document.getElementById('fontColorPicker');
                    if (fontColorPicker) fontColorPicker.value = color;
                    
                    // 应用颜色
                    applyCurrentFontSettings();
                }
            });
        }
        
        // 自定义背景颜色输入框
        const customBgColorInput = document.getElementById('customBgColorInput');
        if (customBgColorInput) {
            customBgColorInput.addEventListener('input', function() {
                let color = this.value;
                if (!color.startsWith('#') && color.length > 0) {
                    color = '#' + color;
                }
                
                if (/^#[0-9A-Fa-f]{6}$/.test(color)) {
                    // 更新色盘值
                    const bgColorPicker = document.getElementById('bgColorPicker');
                    if (bgColorPicker) bgColorPicker.value = color;
                    
                    // 禁用自动反色
                    const autoInvertBg = document.getElementById('autoInvertBg');
                    if (autoInvertBg) autoInvertBg.checked = false;
                    
                    // 应用颜色
                    applyCurrentFontSettings();
                }
            });
        }
        
        // 自动反色背景切换
        const autoInvertBg = document.getElementById('autoInvertBg');
        if (autoInvertBg) {
            autoInvertBg.addEventListener('change', function() {
                applyCurrentFontSettings();
            });
        }
        
        // 设置默认颜色 - 黑色字体，白色背景
        setTimeout(() => {
            const fontColorPicker = document.getElementById('fontColorPicker');
            const bgColorPicker = document.getElementById('bgColorPicker');
            const customColorInput = document.getElementById('customColorInput');
            const customBgColorInput = document.getElementById('customBgColorInput');
            
            if (fontColorPicker) fontColorPicker.value = '#000000';
            if (customColorInput) customColorInput.value = '#000000';
            if (bgColorPicker) bgColorPicker.value = '#FFFFFF';
            if (customBgColorInput) customBgColorInput.value = '#FFFFFF';
            
            // 默认启用自动反色
            const autoInvertBg = document.getElementById('autoInvertBg');
            if (autoInvertBg) autoInvertBg.checked = true;
            
            applyCurrentFontSettings();
        }, 100);
    }
    
    // 获取当前字体颜色
    function getCurrentFontColor() {
        // 检查色盘值
        const fontColorPicker = document.getElementById('fontColorPicker');
        if (fontColorPicker && fontColorPicker.value) {
            return fontColorPicker.value;
        }
        
        // 检查自定义输入框
        const customColorInput = document.getElementById('customColorInput');
        if (customColorInput && customColorInput.value) {
            const color = customColorInput.value.startsWith('#') ? 
                         customColorInput.value : 
                         '#' + customColorInput.value;
            
            if (/^#[0-9A-Fa-f]{6}$/.test(color)) {
                return color;
            }
        }
        
        // 默认黑色
        return '#000000';
    }
    
    // 获取当前背景颜色
    function getCurrentBgColor() {
        // 检查色盘值
        const bgColorPicker = document.getElementById('bgColorPicker');
        if (bgColorPicker && bgColorPicker.value) {
            return bgColorPicker.value;
        }
        
        // 检查自定义输入框
        const customBgColorInput = document.getElementById('customBgColorInput');
        if (customBgColorInput && customBgColorInput.value) {
            const color = customBgColorInput.value.startsWith('#') ? 
                         customBgColorInput.value : 
                         '#' + customBgColorInput.value;
            
            if (/^#[0-9A-Fa-f]{6}$/.test(color)) {
                return color;
            }
        }
        
        // 默认白色
        return '#FFFFFF';
    }
    
    // 应用字体颜色（简化版，直接使用当前设置）
    function applyFontColor(color) {
        // 更新输入框和色盘值
        const customColorInput = document.getElementById('customColorInput');
        const fontColorPicker = document.getElementById('fontColorPicker');
        if (customColorInput) customColorInput.value = color;
        if (fontColorPicker) fontColorPicker.value = color;
        
        // 应用当前设置
        applyCurrentFontSettings();
    }
    
    // 获取颜色的反转色
    function getInvertColor(hex) {
        // 转换为小写并移除#前缀
        hex = hex.replace('#', '').toLowerCase();
        
        // 如果是黑色，直接返回白色
        if (hex === '000000') {
            return '#FFFFFF';
        }
        
        // 如果是白色，直接返回黑色
        if (hex === 'ffffff') {
            return '#000000';
        }
        
        // 解析RGB值
        let r = parseInt(hex.substring(0, 2), 16);
        let g = parseInt(hex.substring(2, 4), 16);
        let b = parseInt(hex.substring(4, 6), 16);
        
        // 计算亮度 (加权RGB值)
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        
        // 生成更自然的对比色
        if (brightness > 125) {
            // 亮色字体 -> 暗色背景，但保持色调
            // 降低亮度，保持色调
            r = Math.max(0, Math.floor(r * 0.2));
            g = Math.max(0, Math.floor(g * 0.2));
            b = Math.max(0, Math.floor(b * 0.2));
            // 确保背景足够暗，便于阅读
            const bgBrightness = (r * 299 + g * 587 + b * 114) / 1000;
            if (bgBrightness > 50) {
                const factor = 50 / bgBrightness;
                r = Math.max(0, Math.floor(r * factor));
                g = Math.max(0, Math.floor(g * factor));
                b = Math.max(0, Math.floor(b * factor));
            }
        } else {
            // 暗色字体 -> 亮色背景，但保持色调
            // 提高亮度，保持色调
            r = Math.min(255, Math.floor(r + (255 - r) * 0.85));
            g = Math.min(255, Math.floor(g + (255 - g) * 0.85));
            b = Math.min(255, Math.floor(b + (255 - b) * 0.85));
            // 确保背景足够亮，便于阅读
            const bgBrightness = (r * 299 + g * 587 + b * 114) / 1000;
            if (bgBrightness < 200) {
                const factor = (255 - bgBrightness) / 55;
                r = Math.min(255, Math.floor(r + (255 - r) * factor));
                g = Math.min(255, Math.floor(g + (255 - g) * factor));
                b = Math.min(255, Math.floor(b + (255 - b) * factor));
            }
        }
        
        // 将RGB值转换为十六进制颜色
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    // 应用生成的字体到预览元素
    function applyGeneratedFontToPreview(font) {
        // 如果存在旧的字体样式表，先移除
        const oldStyle = document.getElementById('custom-font-style');
        if (oldStyle) {
            oldStyle.remove();
        }
        
        try {
            // 创建字体Blob
            const fontBlob = new Blob([font.toArrayBuffer()], { type: 'font/ttf' });
            const fontUrl = URL.createObjectURL(fontBlob);
            
            // 创建新的FontFace实例
            const fontFace = new FontFace('PreviewCustomFont', `url(${fontUrl})`);
            
            // 加载字体
            fontFace.load().then(loadedFace => {
                // 添加字体到文档
                document.fonts.add(loadedFace);
                
                // 创建新的样式表
                const style = document.createElement('style');
                style.id = 'custom-font-style';
                style.textContent = `
                    .custom-font-preview {
                        font-family: 'PreviewCustomFont', sans-serif !important;
                    }
                `;
                
                document.head.appendChild(style);
                
                // 应用字体样式到预览元素
                const previewDisplay = document.getElementById('previewDisplay');
                if (previewDisplay) {
                    previewDisplay.classList.add('custom-font-preview');
                    
                    // 获取当前设置
                    const settings = getFontSettings();
                    
                    // 应用字体大小
                    previewDisplay.style.fontSize = `${settings.fontSize}px`;
                    
                    // 应用字体颜色
                    previewDisplay.style.color = settings.fontColor;
                    
                    // 应用背景色
                    if (settings.autoInvertBg) {
                        const bgColor = getInvertColor(settings.fontColor);
                        previewDisplay.parentElement.style.backgroundColor = bgColor;
                    } else {
                        previewDisplay.parentElement.style.backgroundColor = settings.bgColor;
                    }
                    
                    // 强制重新渲染
                    previewDisplay.style.opacity = '0.99';
                    setTimeout(() => {
                        previewDisplay.style.opacity = '1';
                    }, 10);
                }
                
                console.log("预览字体应用成功");
            }).catch(err => {
                console.error("加载预览字体失败:", err);
            });
            
        } catch (err) {
            console.error("应用预览字体失败:", err);
        }
    }

    // 一键下载TTF
    const downloadTTFBtn = document.getElementById('downloadTTFBtn');
    if (downloadTTFBtn) {
        downloadTTFBtn.onclick = async () => {
            try {
                if (!window.opentype) {
                    alert('OpenType.js 加载失败，请检查网络或刷新页面。');
                    console.error('opentype对象不存在，opentype.js可能未正确加载');
                    return;
                }
                
                // 获取用户输入的字体名称
                const fontNameInput = document.getElementById('fontNameInput');
                const fontName = (fontNameInput && fontNameInput.value) ? fontNameInput.value.trim() : 'CustomFont';
                
                // 如果字体名称为空，使用默认名称
                if (!fontName) {
                    fontNameInput.value = 'CustomFont';
                }
                
                // 显示加载状态
                downloadTTFBtn.disabled = true;
                downloadTTFBtn.textContent = '处理中...';
                
                // 使用页面中的进度条
                const fontProgressWrapper = document.getElementById('fontProgressWrapper');
                const fontProgressBar = document.getElementById('fontProgressBar');
                const fontProgressText = document.getElementById('fontProgressText');
                fontProgressWrapper.style.display = 'inline-flex';
                fontProgressBar.style.width = '0%';
                fontProgressText.textContent = '0%';
                
                // 设置统一的字体度量标准
                const FONT_METRICS = {
                    unitsPerEm: 1000,    // 设计单位
                    ascender: 800,       // 上升部分高度
                    descender: -200,     // 下降部分高度
                    advanceWidth: 800,   // 字符宽度
                    baseline: 0,         // 基线位置
                    xHeight: 500,        // 小写字母高度
                    capHeight: 700       // 大写字母高度
                };
                
                // 创建基本字形
                const notdefPath = new opentype.Path();
                notdefPath.moveTo(100, 0);
                notdefPath.lineTo(0, 0);
                notdefPath.lineTo(0, FONT_METRICS.ascender);
                notdefPath.lineTo(100, FONT_METRICS.ascender);
                notdefPath.lineTo(100, 0);
                
                const glyphs = [
                    new opentype.Glyph({
                        name: '.notdef',
                        unicode: 0,
                        advanceWidth: FONT_METRICS.advanceWidth,
                        path: notdefPath
                    }),
                    new opentype.Glyph({
                        name: 'space',
                        unicode: 32,
                        advanceWidth: FONT_METRICS.advanceWidth,
                        path: new opentype.Path()
                    })
                ];
                
                const canvases = document.querySelectorAll('.char-image-container canvas');
                const chars = document.querySelectorAll('.ocr-item .correction input');
                
                if (canvases.length === 0) {
                    alert('请先上传并识别图片');
                    downloadTTFBtn.disabled = false;
                    downloadTTFBtn.textContent = '下载TTF字体';
                    fontProgressWrapper.style.display = 'none';
                    return;
                }
                
                // 创建离屏Canvas
                const offscreenCanvas = document.createElement('canvas');
                offscreenCanvas.width = 300;
                offscreenCanvas.height = 300;
                const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
                
                // 字符到字形的映射
                const glyphMap = new Map();
                const charInfos = [];
                
                // 收集所有字符信息
                for (let i = 0; i < canvases.length; i++) {
                    const canvas = canvases[i];
                    const char = chars[i].value || '';
                    
                    if (!char) continue;
                    
                    try {
                        // 处理Canvas
                        ctx.fillStyle = 'white';
                        ctx.fillRect(0, 0, 300, 300);
                        
                        // 使用高质量渲染
                        ctx.imageSmoothingEnabled = true;
                        ctx.imageSmoothingQuality = 'high';
                        
                        // 检查是否是组合Canvas
                        if (canvas.classList.contains('composite-canvas')) {
                            ctx.drawImage(canvas, 30, 30, 240, 240);
                        } else {
                            ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 30, 30, 240, 240);
                        }
                        
                        ctx.imageSmoothingEnabled = false;
                        
                        // 二值化处理
                        const imageData = ctx.getImageData(0, 0, 300, 300);
                        const pixels = imageData.data;
                        
                        // 计算平均亮度和阈值
                        let totalBrightness = 0;
                        for (let p = 0; p < pixels.length; p += 4) {
                            totalBrightness += (pixels[p] + pixels[p + 1] + pixels[p + 2]) / 3;
                        }
                        const avgBrightness = totalBrightness / (pixels.length / 4);
                        const threshold = Math.min(Math.max(avgBrightness * 0.85, 160), 220);
                        
                        // 应用二值化
                        for (let p = 0; p < pixels.length; p += 4) {
                            const avg = (pixels[p] + pixels[p + 1] + pixels[p + 2]) / 3;
                            const val = avg < threshold ? 0 : 255;
                            pixels[p] = pixels[p + 1] = pixels[p + 2] = val;
                        }
                        
                        ctx.putImageData(imageData, 0, 0);
                        
                        // 收集黑色像素
                        const blackPixels = [];
                        for (let y = 0; y < 300; y++) {
                            for (let x = 0; x < 300; x++) {
                                const idx = (y * 300 + x) * 4;
                                if (pixels[idx] === 0) {
                                    blackPixels.push({x, y});
                                }
                            }
                        }
                        
                        if (blackPixels.length > 0) {
                            charInfos.push({
                                char: char,
                                pixels: blackPixels
                            });
                        }
                        
                        // 更新进度
                        const progress = Math.round((i + 1) / canvases.length * 50);
                        fontProgressBar.style.width = `${progress}%`;
                        fontProgressText.textContent = `${progress}%`;
                        
                    } catch (err) {
                        console.error(`处理字符 ${char} 失败:`, err);
                    }
                }
                
                // 为每个字符创建字形
                let processedChars = 0;
                for (const info of charInfos) {
                    const char = info.char;
                    if (glyphMap.has(char)) continue;
                    
                    try {
                        const blackPixels = info.pixels;
                        const charPath = new opentype.Path();
                        
                        // 计算边界
                        let minX = 300, minY = 300, maxX = 0, maxY = 0;
                        for (const pixel of blackPixels) {
                            minX = Math.min(minX, pixel.x);
                            minY = Math.min(minY, pixel.y);
                            maxX = Math.max(maxX, pixel.x);
                            maxY = Math.max(maxY, pixel.y);
                        }
                        
                        // 计算缩放和居中
                        const width = maxX - minX + 1;
                        const height = maxY - minY + 1;
                        
                        // 计算缩放比例，确保字形高度适合em方框
                        const targetHeight = FONT_METRICS.ascender - FONT_METRICS.descender;
                        const scale = Math.min(
                            (targetHeight * 0.8) / height,  // 高度缩放
                            (FONT_METRICS.advanceWidth * 0.8) / width  // 宽度缩放
                        );
                        
                        // 计算垂直居中位置
                        const scaledHeight = height * scale;
                        const yOffset = FONT_METRICS.ascender - ((FONT_METRICS.ascender - FONT_METRICS.descender + scaledHeight) / 2);
                        
                        // 计算水平居中位置
                        const scaledWidth = width * scale;
                        const xOffset = (FONT_METRICS.advanceWidth - scaledWidth) / 2;
                        
                        // 按行绘制路径
                        for (let y = minY; y <= maxY; y++) {
                            const rowPixels = blackPixels.filter(p => p.y === y).sort((a, b) => a.x - b.x);
                            if (rowPixels.length === 0) continue;
                            
                            let currentSegment = [];
                            for (const pixel of rowPixels) {
                                if (currentSegment.length === 0 || pixel.x === currentSegment[currentSegment.length - 1].x + 1) {
                                    currentSegment.push(pixel);
                                } else {
                                    // 绘制当前段
                                    if (currentSegment.length >= 2) {
                                        const startX = (currentSegment[0].x - minX) * scale + xOffset;
                                        const endX = (currentSegment[currentSegment.length - 1].x - minX + 1) * scale + xOffset;
                                        const pathY = FONT_METRICS.ascender - ((y - minY) * scale + yOffset);
                                        
                                        charPath.moveTo(startX, pathY);
                                        charPath.lineTo(endX, pathY);
                                        charPath.lineTo(endX, pathY - scale);
                                        charPath.lineTo(startX, pathY - scale);
                                        charPath.close();
                                    }
                                    currentSegment = [pixel];
                                }
                            }
                            
                            // 处理最后一段
                            if (currentSegment.length >= 2) {
                                const startX = (currentSegment[0].x - minX) * scale + xOffset;
                                const endX = (currentSegment[currentSegment.length - 1].x - minX + 1) * scale + xOffset;
                                const pathY = FONT_METRICS.ascender - ((y - minY) * scale + yOffset);
                                
                                charPath.moveTo(startX, pathY);
                                charPath.lineTo(endX, pathY);
                                charPath.lineTo(endX, pathY - scale);
                                charPath.lineTo(startX, pathY - scale);
                                charPath.close();
                            }
                        }
                        
                        // 创建字形
                        const charCode = char.charCodeAt(0);
                        const glyphName = `uni${charCode.toString(16).toUpperCase().padStart(4, '0')}`;
                        
                        const glyph = new opentype.Glyph({
                            name: glyphName,
                            unicode: charCode,
                            advanceWidth: FONT_METRICS.advanceWidth,
                            path: charPath
                        });
                        
                        glyphMap.set(char, glyph);
                        glyphs.push(glyph);
                        
                        // 更新进度
                        processedChars++;
                        const progress = 50 + Math.round(processedChars / charInfos.length * 40);
                        fontProgressBar.style.width = `${progress}%`;
                        fontProgressText.textContent = `${progress}%`;
                        
                    } catch (err) {
                        console.error(`创建字形 ${char} 失败:`, err);
                    }
                }
                
                if (glyphs.length <= 2) {
                    alert('没有有效的字符可以转换为字体');
                    downloadTTFBtn.disabled = false;
                    downloadTTFBtn.textContent = '下载TTF字体';
                    fontProgressWrapper.style.display = 'none';
                    return;
                }
                
                // 创建字体
                try {
                    const font = new opentype.Font({
                        familyName: fontName,
                        styleName: 'Regular',
                        unitsPerEm: FONT_METRICS.unitsPerEm,
                        ascender: FONT_METRICS.ascender,
                        descender: FONT_METRICS.descender,
                        glyphs: glyphs
                    });
                    
                    // 更新进度
                    fontProgressBar.style.width = '90%';
                    fontProgressText.textContent = '90%';
                    
                    // 生成字体文件
                    const fontData = font.toArrayBuffer();
                    
                    // 更新进度
                    fontProgressBar.style.width = '100%';
                    fontProgressText.textContent = '100%';
                    
                    // 下载
                    const blob = new Blob([fontData], { type: 'font/ttf' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${fontName}.ttf`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    
                    // 延迟一秒恢复按钮状态，让用户看到100%
                    setTimeout(() => {
                        fontProgressBar.style.width = '0%';
                        fontProgressWrapper.style.display = 'none';
                        downloadTTFBtn.disabled = false;
                        downloadTTFBtn.textContent = '下载TTF字体';
                    }, 1000);
                    
                } catch (fontError) {
                    console.error('生成字体失败:', fontError);
                    alert('生成字体失败: ' + fontError.message);
                    fontProgressWrapper.style.display = 'none';
                    downloadTTFBtn.disabled = false;
                    downloadTTFBtn.textContent = '下载TTF字体';
                }
                
            } catch (e) {
                console.error('字体生成过程错误:', e);
                alert('字体生成或下载失败：' + e.message);
                const fontProgressWrapper = document.getElementById('fontProgressWrapper');
                if (fontProgressWrapper) {
                    fontProgressWrapper.style.display = 'none';
                }
                downloadTTFBtn.disabled = false;
                downloadTTFBtn.textContent = '下载TTF字体';
            }
        };
    }

    // 生成预览字体
    function generatePreviewFont() {
        console.log("正在生成预览字体...");
        // 获取OCR结果中的字符和图像
        const canvases = document.querySelectorAll('.char-image-container canvas');
        const chars = document.querySelectorAll('.ocr-item .correction input');
        
        if (canvases.length === 0) {
            console.log("没有可用的字符数据");
            return;
        }
        
        // 获取当前参数设置
        const fontSettings = getFontSettings();
        console.log("当前参数设置:", fontSettings);
        
        try {
            // 生成临时字体（与下载字体过程类似，但简化）
            createAndPreviewFont(canvases, chars, fontSettings);
        } catch (err) {
            console.error("预览字体生成失败:", err);
        }
    }
    
    // 创建预览字体
    async function createAndPreviewFont(canvases, chars, settings) {
        if (!window.opentype) {
            console.error('OpenType.js 未加载');
            return;
        }
        
        // 设置统一的字形参数
        const FONT_METRICS = {
            unitsPerEm: 1000,    // 设计单位
            ascender: 800,       // 上升部分高度
            descender: -200,     // 下降部分高度
            advanceWidth: 800,   // 字符宽度
            baseline: 0,         // 基线位置
            xHeight: 500,        // 小写字母高度
            capHeight: 700       // 大写字母高度
        };
        
        // 创建基本字形
        const notdefPath = new opentype.Path();
        notdefPath.moveTo(100, 0);
        notdefPath.lineTo(0, 0);
        notdefPath.lineTo(0, FONT_METRICS.ascender);
        notdefPath.lineTo(100, FONT_METRICS.ascender);
        notdefPath.lineTo(100, 0);
        
        const glyphs = [
            new opentype.Glyph({
                name: '.notdef',
                unicode: 0,
                advanceWidth: FONT_METRICS.advanceWidth,
                path: notdefPath
            }),
            new opentype.Glyph({
                name: 'space',
                unicode: 32,
                advanceWidth: FONT_METRICS.advanceWidth,
                path: new opentype.Path()
            })
        ];
        
        // 创建离屏Canvas
        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = 300;
        offscreenCanvas.height = 300;
        const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
        
        // 字符到字形的映射
        const glyphMap = new Map();
        const charInfos = [];
        
        // 收集所有字符信息
        for (let i = 0; i < canvases.length; i++) {
            const canvas = canvases[i];
            const char = chars[i].value || '';
            
            if (!char) continue;
            
            try {
                // 处理Canvas
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, 300, 300);
                
                // 使用高质量渲染
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                
                // 检查是否是组合Canvas
                if (canvas.classList.contains('composite-canvas')) {
                    ctx.drawImage(canvas, 30, 30, 240, 240);
                } else {
                    ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 30, 30, 240, 240);
                }
                
                ctx.imageSmoothingEnabled = false;
                
                // 二值化处理
                const imageData = ctx.getImageData(0, 0, 300, 300);
                const pixels = imageData.data;
                
                // 计算平均亮度和阈值
                let totalBrightness = 0;
                for (let p = 0; p < pixels.length; p += 4) {
                    totalBrightness += (pixels[p] + pixels[p + 1] + pixels[p + 2]) / 3;
                }
                const avgBrightness = totalBrightness / (pixels.length / 4);
                const threshold = Math.min(Math.max(avgBrightness * 0.85, 160), 220);
                
                // 应用二值化
                for (let p = 0; p < pixels.length; p += 4) {
                    const avg = (pixels[p] + pixels[p + 1] + pixels[p + 2]) / 3;
                    const val = avg < threshold ? 0 : 255;
                    pixels[p] = pixels[p + 1] = pixels[p + 2] = val;
                }
                
                ctx.putImageData(imageData, 0, 0);
                
                // 收集黑色像素
                const blackPixels = [];
                for (let y = 0; y < 300; y++) {
                    for (let x = 0; x < 300; x++) {
                        const idx = (y * 300 + x) * 4;
                        if (pixels[idx] === 0) {
                            blackPixels.push({x, y});
                        }
                    }
                }
                
                if (blackPixels.length > 0) {
                    charInfos.push({
                        char: char,
                        pixels: blackPixels
                    });
                }
            } catch (err) {
                console.error(`处理字符 ${char} 失败:`, err);
            }
        }
        
        // 为每个字符创建字形
        for (const info of charInfos) {
            const char = info.char;
            if (glyphMap.has(char)) continue;
            
            try {
                const blackPixels = info.pixels;
                const charPath = new opentype.Path();
                
                // 计算边界
                let minX = 300, minY = 300, maxX = 0, maxY = 0;
                for (const pixel of blackPixels) {
                    minX = Math.min(minX, pixel.x);
                    minY = Math.min(minY, pixel.y);
                    maxX = Math.max(maxX, pixel.x);
                    maxY = Math.max(maxY, pixel.y);
                }
                
                // 计算缩放和居中
                const width = maxX - minX + 1;
                const height = maxY - minY + 1;
                
                // 计算缩放比例，确保字形高度适合em方框
                const targetHeight = FONT_METRICS.ascender - FONT_METRICS.descender;
                const scale = Math.min(
                    (targetHeight * 0.8) / height,  // 高度缩放
                    (FONT_METRICS.advanceWidth * 0.8) / width  // 宽度缩放
                );
                
                // 计算垂直居中位置
                const scaledHeight = height * scale;
                const yOffset = FONT_METRICS.ascender - ((FONT_METRICS.ascender - FONT_METRICS.descender + scaledHeight) / 2);
                
                // 计算水平居中位置
                const scaledWidth = width * scale;
                const xOffset = (FONT_METRICS.advanceWidth - scaledWidth) / 2;
                
                // 按行绘制路径
                for (let y = minY; y <= maxY; y++) {
                    const rowPixels = blackPixels.filter(p => p.y === y).sort((a, b) => a.x - b.x);
                    if (rowPixels.length === 0) continue;
                    
                    let currentSegment = [];
                    for (const pixel of rowPixels) {
                        if (currentSegment.length === 0 || pixel.x === currentSegment[currentSegment.length - 1].x + 1) {
                            currentSegment.push(pixel);
                        } else {
                            // 绘制当前段
                            if (currentSegment.length >= 2) {
                                const startX = (currentSegment[0].x - minX) * scale + xOffset;
                                const endX = (currentSegment[currentSegment.length - 1].x - minX + 1) * scale + xOffset;
                                const pathY = FONT_METRICS.ascender - ((y - minY) * scale + yOffset);
                                
                                charPath.moveTo(startX, pathY);
                                charPath.lineTo(endX, pathY);
                                charPath.lineTo(endX, pathY - scale);
                                charPath.lineTo(startX, pathY - scale);
                                charPath.close();
                            }
                            currentSegment = [pixel];
                        }
                    }
                    
                    // 处理最后一段
                    if (currentSegment.length >= 2) {
                        const startX = (currentSegment[0].x - minX) * scale + xOffset;
                        const endX = (currentSegment[currentSegment.length - 1].x - minX + 1) * scale + xOffset;
                        const pathY = FONT_METRICS.ascender - ((y - minY) * scale + yOffset);
                        
                        charPath.moveTo(startX, pathY);
                        charPath.lineTo(endX, pathY);
                        charPath.lineTo(endX, pathY - scale);
                        charPath.lineTo(startX, pathY - scale);
                        charPath.close();
                    }
                }
                
                // 创建字形
                const charCode = char.charCodeAt(0);
                const glyphName = `uni${charCode.toString(16).toUpperCase().padStart(4, '0')}`;
                
                const glyph = new opentype.Glyph({
                    name: glyphName,
                    unicode: charCode,
                    advanceWidth: FONT_METRICS.advanceWidth,
                    path: charPath
                });
                
                glyphMap.set(char, glyph);
                glyphs.push(glyph);
                
            } catch (err) {
                console.error(`创建字形 ${char} 失败:`, err);
            }
        }
        
        if (glyphs.length <= 2) {
            console.error("没有有效的字形可用于预览");
            return;
        }
        
        // 创建字体
        try {
            const font = new opentype.Font({
                familyName: 'PreviewFont',
                styleName: 'Regular',
                unitsPerEm: FONT_METRICS.unitsPerEm,
                ascender: FONT_METRICS.ascender,
                descender: FONT_METRICS.descender,
                glyphs: glyphs
            });
            
            // 显示预览
            applyGeneratedFontToPreview(font);
            
        } catch (err) {
            console.error("创建预览字体失败:", err);
        }
    }

    function enhanceCharacterImage(canvas) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        
        // 应用二值化处理
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // 计算图像亮度分布
        let totalBrightness = 0;
        let pixelCount = 0;
        let histogram = new Array(256).fill(0);
        
        for (let i = 0; i < data.length; i += 4) {
            const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
            totalBrightness += avg;
            pixelCount++;
            histogram[Math.floor(avg)]++;
        }
        
        // 计算平均亮度和动态阈值
        const avgBrightness = totalBrightness / pixelCount;
        const threshold = Math.min(Math.max(avgBrightness * 0.85, 160), 220);
        
        // 使用动态阈值进行二值化
        for (let i = 0; i < data.length; i += 4) {
            const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
            if (avg < threshold) {
                data[i] = 0;      // R
                data[i + 1] = 0;  // G
                data[i + 2] = 0;  // B
            } else {
                data[i] = 255;    // R
                data[i + 1] = 255;// G
                data[i + 2] = 255;// B
            }
            data[i + 3] = 255;    // 确保完全不透明
        }
        
        ctx.putImageData(imageData, 0, 0);
        
        // 应用边缘增强和锐化
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        
        // 复制原始图像
        tempCtx.drawImage(canvas, 0, 0);
        
        // 清除原始画布
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // 应用多次渲染以增强边缘
        ctx.globalCompositeOperation = 'multiply';
        ctx.filter = 'contrast(1.2) brightness(1.05)';
        ctx.drawImage(tempCanvas, 0, 0);
        ctx.drawImage(tempCanvas, 0, 0);
        
        // 恢复默认设置
        ctx.globalCompositeOperation = 'source-over';
        ctx.filter = 'none';
    }

    async function generateFont() {
        // 获取所有OCR项
        const allOcrItems = document.querySelectorAll('.ocr-item');
        if (allOcrItems.length === 0) return;

        // 创建离屏Canvas用于字形处理
        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = 300;  // 使用300x300的分辨率
        offscreenCanvas.height = 300;
        const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });

        // 字符到字形的映射
        const glyphMap = new Map();
        const charInfos = [];

        // 收集所有字符信息
        for (const item of allOcrItems) {
            const canvas = item.querySelector('canvas');
            const char = item.querySelector('input').value;
            
            if (!char || !canvas) continue;

            try {
                // 处理Canvas
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, 300, 300);
                
                // 使用高质量渲染
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(canvas, 0, 0);
                ctx.imageSmoothingEnabled = false;

                // 获取图像数据
                const imageData = ctx.getImageData(0, 0, 300, 300);
                const pixels = imageData.data;

                // 收集黑色像素
                const blackPixels = [];
                for (let y = 0; y < 300; y++) {
                    for (let x = 0; x < 300; x++) {
                        const idx = (y * 300 + x) * 4;
                        const avg = (pixels[idx] + pixels[idx + 1] + pixels[idx + 2]) / 3;
                        if (avg < 128) {
                            blackPixels.push({ x, y });
                        }
                    }
                }

                if (blackPixels.length > 0) {
                    charInfos.push({
                        char: char,
                        pixels: blackPixels
                    });
                }
            } catch (e) {
                console.error('处理字符时出错:', e);
            }
        }

        // 创建字体
        try {
            // 创建字形
            const glyphs = [];
            const notdefGlyph = new opentype.Glyph({
                name: '.notdef',
                unicode: 0,
                advanceWidth: 650,
                path: new opentype.Path()
            });
            glyphs.push(notdefGlyph);

            // 添加空格字符
            const spaceGlyph = new opentype.Glyph({
                name: 'space',
                unicode: 32,
                advanceWidth: 650,
                path: new opentype.Path()
            });
            glyphs.push(spaceGlyph);

            // 处理每个字符
            for (const info of charInfos) {
                const char = info.char;
                if (glyphMap.has(char)) continue;

                const pixels = info.pixels;
                const path = new opentype.Path();
                
                // 计算字符边界
                let minX = 300, minY = 300, maxX = 0, maxY = 0;
                for (const pixel of pixels) {
                    minX = Math.min(minX, pixel.x);
                    minY = Math.min(minY, pixel.y);
                    maxX = Math.max(maxX, pixel.x);
                    maxY = Math.max(maxY, pixel.y);
                }

                // 计算缩放和居中
                const width = maxX - minX + 1;
                const height = maxY - minY + 1;
                const scale = Math.min(600 / width, 600 / height) * 0.8;
                
                // 创建字形路径
                for (const pixel of pixels) {
                    const x = (pixel.x - minX) * scale;
                    const y = (pixel.y - minY) * scale;
                    path.moveTo(x, y);
                    path.lineTo(x + scale, y);
                    path.lineTo(x + scale, y + scale);
                    path.lineTo(x, y + scale);
                    path.close();
                }

                // 创建字形
                const glyph = new opentype.Glyph({
                    name: char,
                    unicode: char.charCodeAt(0),
                    advanceWidth: 650,
                    path: path
                });

                glyphs.push(glyph);
                glyphMap.set(char, glyph);
            }

            // 创建字体
            const font = new opentype.Font({
                familyName: 'CustomFont',
                styleName: 'Regular',
                unitsPerEm: 1000,
                ascender: 800,
                descender: -200,
                glyphs: glyphs
            });

            // 下载字体
            const buffer = font.toArrayBuffer();
            const blob = new Blob([buffer], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'custom-font.ttf';
            link.click();
            URL.revokeObjectURL(url);

        } catch (e) {
            console.error('生成字体时出错:', e);
            alert('生成字体时出错，请检查字符识别结果是否正确。');
        }
    }
}); 