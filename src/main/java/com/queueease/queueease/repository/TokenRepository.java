package com.queueease.queueease.repository;

import com.queueease.queueease.entity.Token;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;
import java.util.List;

public interface TokenRepository extends JpaRepository<Token, Long> {

    List<Token> findByDoctorIdAndTokenDateOrderByTokenNumberAsc(
            Long doctorId,
            LocalDate tokenDate
    );

    List<Token> findByDoctorIdAndTokenDateAndStatusOrderByTokenNumberAsc(
            Long doctorId,
            LocalDate tokenDate,
            String status
    );
}