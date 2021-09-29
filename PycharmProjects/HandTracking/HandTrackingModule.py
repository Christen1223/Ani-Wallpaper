import cv2
import mediapipe as mp
import time

class handDetection():
    def __init__(self, imageMode = False, maxHands = 2, minDeteCon = 0.5, minTrackCon = 0.5):
        self.imageMode = imageMode
        self.maxHands = maxHands
        self.minDeteCon = minDeteCon
        self.minTrackCon = minTrackCon

        self.mpHands = mp.solutions.hands
        self.hands = self.mpHands.Hands(self.imageMode, self.maxHands, self.minDeteCon, self.minTrackCon)
        self.drawMp = mp.solutions.drawing_utils

    def identifyHands(self, img, draw = True):
        imgRgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        self.results = self.hands.process(imgRgb)

        if self.results.multi_hand_landmarks:
            for handLm in self.results.multi_hand_landmarks:
                if draw:
                    self.drawMp.draw_landmarks(img, handLm, self.mpHands.HAND_CONNECTIONS)
        return img

    def handPointPos(self, img, handNum = 0, draw = True):
        landmarks = []
        if self.results.multi_hand_landmarks:
            hand = self.results.multi_hand_landmarks[handNum]
            for idNum, landmark in enumerate(hand.landmark):
                height, width, channel = img.shape
                centerX, centerY = int(landmark.x * width), int(landmark.y * height)
                #print(idNum, centerX, centerY)
                landmarks.append([idNum, centerX, centerY])

                if draw:
                    cv2.circle(img, (centerX, centerY), 15, (255,255,0), cv2.FILLED)
        return landmarks

def main():
    previousTime = 0
    currentTime = 0
    cam = cv2.VideoCapture(0)
    detection = handDetection()
    while True:
        success, img = cam.read()
        img = detection.identifyHands(img)
        landmarks = detection.handPointPos(img)
        if len(landmarks) != 0:
            print(landmarks[4])

        currentTime = time.time()
        fps = 1 / (currentTime - previousTime)
        previousTime = currentTime

        cv2.putText(img, str(int(fps)), (10, 70), cv2.FONT_HERSHEY_PLAIN, 3, (255, 0, 255), 3)

        cv2.imshow("Image", img)
        cv2.waitKey(1)


if __name__ == "__main__":
    main()