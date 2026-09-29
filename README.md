# QueueEase 🏥

### Smart OPD Token & Queue Management System

QueueEase is a web-based hospital OPD queue management system developed using **Spring Boot, Java, MySQL, HTML, CSS, and JavaScript**.

The system helps receptionists and doctors manage patients, generate OPD tokens, handle priority patients, calculate estimated waiting time, and track the consultation process digitally.

---

## 📌 Problem Statement

Traditional hospital OPD queues can become difficult to manage when multiple patients are waiting for the same doctor.

Patients may not know:

- Their token number
- How many patients are ahead of them
- Their estimated waiting time
- Whether they are currently being served

QueueEase provides a centralized digital system to manage this process efficiently.

---

## 💡 Solution

QueueEase digitizes the complete OPD token workflow:

```text
Patient Registration
        ↓
Select Doctor
        ↓
Generate Token
        ↓
Join Queue
        ↓
Estimated Waiting Time
        ↓
Call Next Patient
        ↓
Consultation
        ↓
Complete Consultation
