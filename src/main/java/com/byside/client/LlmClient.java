package com.byside.client;

import java.util.Map;

import com.byside.config.LlmProperties;
import com.byside.dto.upstream.UpstreamChatResponse;
import com.byside.exception.LlmException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

@Slf4j
@Component
@RequiredArgsConstructor
public class LlmClient {

    private final RestClient llmRestClient;

    private final LlmProperties properties;

    public String getDefaultModel() {
        return properties.getModel();
    }

    public String getVisionModel() {
        return properties.getVisionModel();
    }

    public UpstreamChatResponse chatCompletion(Map<String, Object> payload) {
        if (!StringUtils.hasText(properties.getApiKey())) {
            throw new LlmException("未配置 JDC_API_KEY", HttpStatus.INTERNAL_SERVER_ERROR);
        }

        try {
            return llmRestClient.post()
                    .uri("/chat/completions")
                    .body(payload)
                    .retrieve()
                    .body(UpstreamChatResponse.class);
        } catch (RestClientResponseException e) {
            log.error("LLM upstream error status={} body={}", e.getStatusCode(), e.getResponseBodyAsString());
            throw new LlmException(
                    "上游服务返回错误 " + e.getStatusCode().value(), HttpStatus.BAD_GATEWAY, e);
        } catch (ResourceAccessException e) {
            log.error("LLM upstream request failed", e);
            throw new LlmException("上游服务请求失败: " + e.getMessage(), HttpStatus.BAD_GATEWAY, e);
        }
    }
}
