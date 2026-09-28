package com.queueease.queueease.controller;

import com.queueease.queueease.entity.Token;
import com.queueease.queueease.service.TokenService;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/tokens")
public class TokenController {

    private final TokenService tokenService;

    public TokenController(TokenService tokenService) {
        this.tokenService = tokenService;
    }

    @PostMapping("/generate")
    public Token generateToken(
            @RequestParam Long doctorId,
            @RequestParam Long patientId,
            @RequestParam boolean priority) {

        return tokenService.generateToken(
                doctorId,
                patientId,
                priority
        );
    }

    @GetMapping
    public List<Token> getAllTokens() {
        return tokenService.getAllTokens();
    }

    @PostMapping("/next/{doctorId}")
    public Token callNextToken(@PathVariable Long doctorId) {

        return tokenService.callNextToken(doctorId);
    }

    @PutMapping("/{id}/complete")
    public Token completeToken(@PathVariable Long id) {

        return tokenService.completeToken(id);
    }

    @GetMapping("/history/{doctorId}")
    public List<Token> getTokenHistory(@PathVariable Long doctorId) {

        return tokenService.getTokenHistory(doctorId);
    }
}