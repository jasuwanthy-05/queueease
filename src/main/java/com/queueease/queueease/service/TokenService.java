package com.queueease.queueease.service;

import com.queueease.queueease.entity.Doctor;
import com.queueease.queueease.entity.Patient;
import com.queueease.queueease.entity.Token;
import com.queueease.queueease.repository.DoctorRepository;
import com.queueease.queueease.repository.PatientRepository;
import com.queueease.queueease.repository.TokenRepository;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.List;

@Service
public class TokenService {

    private final TokenRepository tokenRepository;
    private final DoctorRepository doctorRepository;
    private final PatientRepository patientRepository;

    public TokenService(
            TokenRepository tokenRepository,
            DoctorRepository doctorRepository,
            PatientRepository patientRepository) {

        this.tokenRepository = tokenRepository;
        this.doctorRepository = doctorRepository;
        this.patientRepository = patientRepository;
    }

    public Token generateToken(Long doctorId, Long patientId, boolean priority) {

        Doctor doctor = doctorRepository.findById(doctorId).orElseThrow();
        Patient patient = patientRepository.findById(patientId).orElseThrow();

        LocalDate today = LocalDate.now();

        List<Token> todayTokens =
                tokenRepository.findByDoctorIdAndTokenDateOrderByTokenNumberAsc(
                        doctorId, today);

        int nextTokenNumber = todayTokens.size() + 1;

        Token token = new Token();

        token.setTokenNumber(nextTokenNumber);
        token.setTokenDate(today);
        token.setPriority(priority);
        token.setStatus("WAITING");
        token.setDoctor(doctor);
        token.setPatient(patient);

        int waitingPatients = 0;

        for (Token t : todayTokens) {
            if ("WAITING".equals(t.getStatus())) {
                waitingPatients++;
            }
        }

        token.setEstimatedWaitTime(
                waitingPatients * doctor.getAverageConsultationTime()
        );

        return tokenRepository.save(token);
    }

    public List<Token> getAllTokens() {
        return tokenRepository.findAll();
    }

    public Token callNextToken(Long doctorId) {

        LocalDate today = LocalDate.now();

        List<Token> waitingTokens =
                tokenRepository
                        .findByDoctorIdAndTokenDateAndStatusOrderByTokenNumberAsc(
                                doctorId,
                                today,
                                "WAITING"
                        );

        if (waitingTokens.isEmpty()) {
            throw new RuntimeException("No waiting tokens");
        }

        Token selectedToken = waitingTokens.get(0);

        for (Token token : waitingTokens) {

            if (token.isPriority()) {
                selectedToken = token;
                break;
            }
        }

        selectedToken.setStatus("SERVING");

        return tokenRepository.save(selectedToken);
    }

    public Token completeToken(Long tokenId) {

        Token token = tokenRepository.findById(tokenId).orElseThrow();

        token.setStatus("COMPLETED");

        return tokenRepository.save(token);
    }

    public List<Token> getTokenHistory(Long doctorId) {

        LocalDate today = LocalDate.now();

        return tokenRepository.findByDoctorIdAndTokenDateOrderByTokenNumberAsc(
                doctorId,
                today
        );
    }
}