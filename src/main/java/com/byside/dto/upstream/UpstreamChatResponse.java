package com.byside.dto.upstream;

import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class UpstreamChatResponse {

    private String model;

    private List<Choice> choices;

    private Map<String, Object> usage;

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Choice {

        private UpstreamMessage message;

        @JsonProperty("finish_reason")
        private String finishReason;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class UpstreamMessage {

        private String role;

        private Object content;
    }
}
