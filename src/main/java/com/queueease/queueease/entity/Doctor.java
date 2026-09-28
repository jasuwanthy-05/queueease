package com.queueease.queueease.entity;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;

@Entity
public class Doctor {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String name;

    private String specialization;

    private int averageConsultationTime;

    public Doctor() {
    }

    public Doctor(String name, String specialization, int averageConsultationTime) {
        this.name = name;
        this.specialization = specialization;
        this.averageConsultationTime = averageConsultationTime;
    }

    public Long getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getSpecialization() {
        return specialization;
    }

    public void setSpecialization(String specialization) {
        this.specialization = specialization;
    }

    public int getAverageConsultationTime() {
        return averageConsultationTime;
    }

    public void setAverageConsultationTime(int averageConsultationTime) {
        this.averageConsultationTime = averageConsultationTime;
    }
}