import cv2
import math
import osascript
import HandTrackingModule as htm

cam = cv2.VideoCapture(0)
handDetection = htm.handDetection()

while True:
    success, img = cam.read()
    img = handDetection.identifyHands(img)
    landmarks = handDetection.handPointPos(img, draw=False)

    if landmarks != []:
        xIdex, yIdex = landmarks[8][1], landmarks[8][2]
        xThumb, yThumb = landmarks[4][1], landmarks[4][2]

        cv2.circle(img,(xIdex,yIdex), 15, (255,255,0), cv2.FILLED)
        cv2.circle(img, (xThumb, yThumb), 15, (255, 255, 0), cv2.FILLED)
        cv2.line(img,(xIdex,yIdex),(xThumb,yThumb),(255,0,255),thickness=3)

        fingerDistance = math.sqrt(math.pow((xIdex - xThumb), 2) + math.pow((yIdex - yThumb), 2))
        volume = "set volume output volume " + str(round(fingerDistance/5))
        osascript.osascript(volume)

    cv2.imshow("Image", img)
    cv2.waitKey(1)