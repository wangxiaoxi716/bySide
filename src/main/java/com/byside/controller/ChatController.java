package com.byside.controller;

import com.byside.dto.ChatRequest;
import com.byside.dto.ChatResponse;
import com.byside.exception.LlmException;
import com.byside.service.ChatService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1/chat")
@RequiredArgsConstructor
public class ChatController {

    private final ChatService chatService;

    @PostMapping("/completions")
    public ResponseEntity<ChatResponse> completions(@Valid @RequestBody ChatRequest request) {
        return ResponseEntity.ok(chatService.chat(request));
    }

    @PostMapping("/image")
    public ResponseEntity<ChatResponse> image(
            @RequestParam("prompt") String prompt,
            @RequestParam(value = "max_tokens", defaultValue = "512") int maxTokens,
            @RequestParam("file") MultipartFile file) {

        if (file.isEmpty()) {
            throw new LlmException("上传文件为空", HttpStatus.BAD_REQUEST);
        }

        try {
            byte[] imageBytes = file.getBytes();
            String mimeType = file.getContentType() != null ? file.getContentType() : "image/png";
            return ResponseEntity.ok(chatService.chatWithImage(prompt, imageBytes, mimeType, maxTokens));
        } catch (java.io.IOException e) {
            throw new LlmException("图片读取失败: " + e.getMessage(), HttpStatus.BAD_REQUEST, e);
        } catch (LlmException e) {
            throw e;
        } catch (Exception e) {
            throw new LlmException("图片处理失败: " + e.getMessage(), HttpStatus.BAD_REQUEST, e);
        }
    }
}
