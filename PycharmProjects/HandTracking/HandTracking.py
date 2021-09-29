import cv2
import mediapipe as mp
import time

cam = cv2.VideoCapture(0)

mpHands = mp.solutions.hands
hands = mpHands.Hands()
draw = mp.solutions.drawing_utils

previousTime = 0
currentTime = 0

while True:
    success, img = cam.read()
    imgRgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    results = hands.process(imgRgb)

    if results.multi_hand_landmarks:
        for handLm in results.multi_hand_landmarks:
            for idNum, landmark in enumerate(handLm.landmark):
                height, width, channel = img.shape
                centerX, centerY = int(landmark.x * width), int(landmark.y * height)
                print(id, centerX, centerY)
                cv2.circle(img, (centerX, centerY), 15, (255, 0, 255), cv2.FILLED)
            draw.draw_landmarks(img, handLm, mpHands.HAND_CONNECTIONS)

    currentTime = time.time()
    fps = 1/(currentTime - previousTime)
    previousTime = currentTime

    cv2.putText(img,str(int(fps)),(10,70), cv2.FONT_HERSHEY_PLAIN,3,(255,0,255),3)

    cv2.imshow("Image", img)
    cv2.waitKey(1)