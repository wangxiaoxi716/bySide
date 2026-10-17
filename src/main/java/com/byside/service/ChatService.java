package com.byside.service;

import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.byside.client.LlmClient;
import com.byside.dto.ChatRequest;
import com.byside.dto.ChatResponse;
import com.byside.dto.upstream.UpstreamChatResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class ChatService {

    private final LlmClient llmClient;

    public ChatResponse chat(ChatRequest request) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("messages", request.getMessages());
        payload.put("model", request.getModel() != null ? request.getModel() : llmClient.getDefaultModel());
        payload.put("max_tokens", request.getMaxTokens());
        if (request.getTemperature() != null) {
            payload.put("temperature", request.getTemperature());
        }

        return toResponse(llmClient.chatCompletion(payload));
    }

    public ChatResponse chatWithImage(String prompt, byte[] imageBytes, String mimeType, int maxTokens) {
        String dataUrl = "data:" + mimeType + ";base64," + Base64.getEncoder().encodeToString(imageBytes);

        List<Map<String, Object>> content = new ArrayList<>();
        content.add(Map.of("type", "text", "text", prompt));
        content.add(Map.of("type", "image_url", "image_url", Map.of("url", dataUrl)));

        Map<String, Object> payload = new HashMap<>();
        payload.put("model", llmClient.getVisionModel());
        payload.put("messages", List.of(Map.of("role", "user", "content", content)));
        payload.put("max_tokens", maxTokens);

        return toResponse(llmClient.chatCompletion(payload));
    }

    private ChatResponse toResponse(UpstreamChatResponse upstream) {
        if (upstream == null || upstream.getChoices() == null || upstream.getChoices().isEmpty()) {
            throw new com.byside.exception.LlmException(
                    "上游响应缺少 choices", org.springframework.http.HttpStatus.BAD_GATEWAY);
        }

        UpstreamChatResponse.Choice choice = upstream.getChoices().get(0);
        String content = extractContent(choice.getMessage());

        return ChatResponse.builder()
                .model(upstream.getModel() != null ? upstream.getModel() : "")
                .content(content)
                .finishReason(choice.getFinishReason())
                .usage(upstream.getUsage())
                .build();
    }

    private String extractContent(UpstreamChatResponse.UpstreamMessage message) {
        if (message == null || message.getContent() == null) {
            return "";
        }
        Object content = message.getContent();
        if (content instanceof String text) {
            return text;
        }
        if (content instanceof List<?> parts) {
            StringBuilder sb = new StringBuilder();
            for (Object part : parts) {
                if (part instanceof Map<?, ?> map) {
                    Object text = map.get("text");
                    if (text != null) {
                        sb.append(text);
                    }
                }
            }
            return sb.toString();
        }
        return String.valueOf(content);
    }
}
