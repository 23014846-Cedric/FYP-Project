# Card Delivery Reconciliation Portal  
A Full-Stack Node.js + Express + MongoDB portal for managing physical card deliveries, exceptions, audit logs, and reconciliation processes.  
This project was built as part of a Final Year Project (FYP) for a Diploma in Cybersecurity.

🔗 **Live Application:**  
https://fyp-project-live.onrender.com/login

---

## 📌 Overview  
The Card Delivery Reconciliation Portal allows administrators and delivery partners to manage:

- Card dispatch records  
- Delivery status updates  
- Exception handling  
- Audit logging for compliance  
- User-role-based dashboards  
- Secure data views (masked card numbers for non-admin users)  

The system enhances operational transparency, reduces reconciliation errors, and improves traceability across the delivery lifecycle.

---

## ✨ Features  

### 👨‍💼 **Role-Based Access Control**
- **Admin users** can view all deliveries, exceptions, audit logs, and perform imports.
- **Standard users** can view only their assigned deliveries (filtered by recipient name).
- Sensitive data like card numbers is masked for non-admin accounts.

### 📦 **Delivery Management**
- Add deliveries manually  
- Import deliveries via Excel (.xlsx / .csv)  
- Update delivery status  
- Track dispatch dates, couriers, recipients  
- Auto-timestamp updates  

### 📊 **Dashboard**
- Summary statistics (Delivered / In Transit / Failed)  
- Dynamic table based on user role  
- Masked card numbers for standard users  
- “View All Deliveries” button (admin only)

### ⚠️ **Exception Handling**
- Track failed deliveries  
- Add notes / reasons  
- Filter exceptions separately  

### 🧾 **Audit Trail**
Every critical action is logged with:
- Timestamp  
- User  
- Action type  
- Entity changed  
- Old → New values  
- Optional remarks  

This supports compliance and forensic traceability.

### 🔐 **Security Features**
- JWT authentication  
- Role-based UI hiding  
- Masked sensitive data  
- Input validation  
- Password hashing (bcrypt)  

---

## 🛠️ Tech Stack

| Component | Technology |
|----------|------------|
| Backend  | Node.js, Express.js |
| Frontend | EJS Templates, Bootstrap |
| Database | MongoDB Atlas |
| Auth     | JWT, bcrypt |
| File Upload | Multer |
| Excel Parsing | xlsx |
| Deployment | Render.com |

---

## 🚀 Deployment  
The project is deployed on **Render (Web Service)**, running a live Node.js Express server:

🔗 **Live URL:**  
https://fyp-project-live.onrender.com/login

---

## 🧩 Folder Structure

